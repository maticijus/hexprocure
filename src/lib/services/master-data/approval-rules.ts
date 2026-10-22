import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalRules } from "@/lib/db/schema";
import { Money } from "@/domain/money";
import { validateApprovalRules } from "@/domain/approval";
import { BodyReader, definedOnly } from "@/lib/api/validate";
import { audit, DomainError, type DbOrTx } from "@/lib/services/p2p/shared";

export type ApprovalRuleRow = typeof approvalRules.$inferSelect;
export const APPROVER_ROLES = ["MANAGER", "FINANCE", "ADMIN"] as const;
export interface ApprovalRuleInput {
  sequence?: number;
  minMinor: number;
  maxMinor: number | null;
  approverRole: (typeof APPROVER_ROLES)[number];
  currency: string;
}

export function parseApprovalRuleInput(body: unknown, partial = false): Partial<ApprovalRuleInput> {
  const reader = new BodyReader(body, true);
  const input = definedOnly({
    sequence: reader.nonNegativeInt("sequence"),
    minMinor: reader.nonNegativeInt("minMinor"),
    maxMinor: reader.optionalNonNegativeInt("maxMinor"),
    approverRole: reader.oneOf("approverRole", APPROVER_ROLES),
    currency: reader.currency("currency"),
  });
  if (!partial) {
    for (const field of ["minMinor", "approverRole", "currency"] as const) {
      if (!(field in input) && !reader.errors.some((e) => e.startsWith(field))) {
        reader.errors.push(`${field} is required`);
      }
    }
  }
  reader.done();
  return { ...(partial ? {} : { maxMinor: null }), ...input };
}

export async function listApprovalRules(opts: { includeArchived?: boolean } = {}) {
  return db
    .select()
    .from(approvalRules)
    .where(opts.includeArchived ? undefined : isNull(approvalRules.archivedAt))
    .orderBy(asc(approvalRules.currency), asc(approvalRules.sequence));
}

export async function getApprovalRule(id: string): Promise<ApprovalRuleRow> {
  const [row] = await db.select().from(approvalRules).where(eq(approvalRules.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Approval rule not found");
  return row;
}

type Candidate = Pick<ApprovalRuleRow, "sequence" | "minMinor" | "maxMinor" | "approverRole" | "currency">;

/** Runs the domain rule-set check (min below max, one currency, no overlapping
 *  bounded bands) over the active rules of the candidate's currency. */
async function assertFitsRuleSet(tx: DbOrTx, candidate: Candidate, exceptId?: string) {
  const others = await tx
    .select()
    .from(approvalRules)
    .where(
      and(
        eq(approvalRules.currency, candidate.currency),
        isNull(approvalRules.archivedAt),
        exceptId ? ne(approvalRules.id, exceptId) : undefined,
      ),
    );
  const toDomain = (r: Candidate, label: string) => ({
    id: label,
    minAmount: Money.of(r.minMinor, r.currency),
    maxAmount: r.maxMinor === null ? undefined : Money.of(r.maxMinor, r.currency),
    approverRole: r.approverRole,
  });
  try {
    validateApprovalRules([
      toDomain(candidate, "this rule"),
      ...others.map((r) => toDomain(r, `step ${r.sequence}`)),
    ]);
  } catch (error) {
    throw new DomainError("VALIDATION", ruleSetMessage((error as Error).message));
  }
}

function ruleSetMessage(domainMessage: string): string {
  if (domainMessage.includes("max must be greater than min")) return "maxMinor must be greater than minMinor";
  const overlap = /^Approval rules (.+) and (.+) overlap$/.exec(domainMessage);
  if (overlap) {
    const other = overlap[1] === "this rule" ? overlap[2] : overlap[1];
    return `This amount band overlaps ${other}`;
  }
  return domainMessage;
}

async function nextSequence(tx: DbOrTx, currency: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number | null>`max(${approvalRules.sequence})` })
    .from(approvalRules)
    .where(eq(approvalRules.currency, currency));
  return row?.max === null || row?.max === undefined ? 1 : Number(row.max) + 1;
}

export async function createApprovalRule(input: ApprovalRuleInput, actorUserId: string): Promise<ApprovalRuleRow> {
  return db.transaction(async (tx) => {
    // Serialize rule edits so two concurrent creates cannot both pass the overlap check.
    await tx.execute(sql`LOCK TABLE approval_rules IN SHARE ROW EXCLUSIVE MODE`);
    const values = { ...input, sequence: input.sequence ?? (await nextSequence(tx, input.currency)) };
    await assertFitsRuleSet(tx, values);
    const [row] = await tx.insert(approvalRules).values(values).returning();
    await audit(tx, "approval_rule", row.id, "CREATED", actorUserId);
    return row;
  });
}

export async function updateApprovalRule(
  id: string,
  patch: Partial<ApprovalRuleInput>,
  actorUserId: string,
): Promise<ApprovalRuleRow> {
  const current = await getApprovalRule(id);
  if (current.archivedAt) throw new DomainError("INVALID_STATE", "Archived approval rules cannot be edited");
  if (Object.keys(patch).length === 0) return current;
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE approval_rules IN SHARE ROW EXCLUSIVE MODE`);
    await assertFitsRuleSet(tx, { ...current, ...patch }, id);
    const [row] = await tx.update(approvalRules).set(patch).where(eq(approvalRules.id, id)).returning();
    await audit(tx, "approval_rule", id, "UPDATED", actorUserId, { fields: Object.keys(patch) });
    return row;
  });
}

export async function archiveApprovalRule(id: string, actorUserId: string): Promise<ApprovalRuleRow> {
  const current = await getApprovalRule(id);
  if (current.archivedAt) return current;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(approvalRules)
      .set({ archivedAt: new Date() })
      .where(eq(approvalRules.id, id))
      .returning();
    await audit(tx, "approval_rule", id, "ARCHIVED", actorUserId);
    return row;
  });
}
