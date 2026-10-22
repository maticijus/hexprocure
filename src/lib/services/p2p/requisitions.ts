import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  approvalRules,
  approvals,
  integrationEvents,
  requisitionLines,
  requisitions,
  suppliers,
  users,
} from "@/lib/db/schema";
import { Money } from "@/domain/money";
import { resolveApprovalChain } from "@/domain/approval";
import { audit, DomainError, type Tx } from "./shared";

type Requisition = typeof requisitions.$inferSelect;
type ApprovalRule = typeof approvalRules.$inferSelect;
type Approval = typeof approvals.$inferSelect;
type ApprovalStep = ReturnType<typeof resolveApprovalChain>[number];

async function loadSubmittable(tx: Tx, requisitionId: string) {
  const [req] = await tx.select().from(requisitions).where(eq(requisitions.id, requisitionId));
  if (!req) throw new DomainError("NOT_FOUND", "Requisition not found");
  if (req.status !== "DRAFT") {
    throw new DomainError("INVALID_STATE", `Cannot submit from ${req.status}`);
  }
  const lines = await tx
    .select()
    .from(requisitionLines)
    .where(eq(requisitionLines.requisitionId, requisitionId));
  if (lines.length === 0) {
    throw new DomainError("INVALID_STATE", "Requisition has no lines");
  }
  const total = lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
  return { req, total };
}

async function buildApprovalChain(tx: Tx, req: Requisition, total: number) {
  const rules: ApprovalRule[] = await tx
    .select()
    .from(approvalRules)
    .where(eq(approvalRules.currency, req.currency))
    .orderBy(asc(approvalRules.sequence));
  if (rules.length === 0) {
    throw new DomainError("INVALID_STATE", "No approval rules configured");
  }
  return resolveApprovalChain(Money.of(total, req.currency), rules.map((r) => ({
    id: r.id,
    minAmount: Money.of(r.minMinor, r.currency),
    maxAmount: r.maxMinor === null ? undefined : Money.of(r.maxMinor, r.currency),
    approverRole: r.approverRole,
  })));
}

async function persistSubmission(
  tx: Tx,
  requisitionId: string,
  chain: ApprovalStep[],
  total: number,
  actorUserId: string,
) {
  await tx.insert(approvals).values(
    chain.map((step, i) => ({
      requisitionId,
      ruleId: step.ruleId,
      approverRole: step.approverRole,
      sequence: i,
    })),
  );
  await tx.update(requisitions).set({ status: "SUBMITTED" }).where(eq(requisitions.id, requisitionId));
  await audit(tx, "requisition", requisitionId, "SUBMITTED", actorUserId, { total });
}

async function emitApprovalRequests(tx: Tx, req: Requisition, chain: ApprovalStep[], total: number) {
  const [supplierRow] = await tx.select().from(suppliers).where(eq(suppliers.id, req.supplierId));
  const roleUsers = await tx.select({ email: users.email, role: users.role }).from(users);
  for (const step of chain) {
    const recipients = roleUsers.filter((u) => u.role === step.approverRole).map((u) => u.email);
    if (recipients.length === 0) continue;
    await tx.insert(integrationEvents).values({
      eventType: "APPROVAL_REQUESTED",
      payload: {
        to: recipients,
        requisitionId: req.id,
        supplier: supplierRow?.name ?? "",
        totalMinor: total,
        currency: req.currency,
      },
    });
  }
}

async function assertCanSubmit(tx: Tx, requesterId: string, actorUserId: string) {
  if (requesterId === actorUserId) return;
  const [actor] = await tx.select().from(users).where(eq(users.id, actorUserId));
  if (actor?.role !== "ADMIN") {
    throw new DomainError("FORBIDDEN", "Only the requester or an ADMIN can submit");
  }
}

export async function submitRequisition(requisitionId: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const { req, total } = await loadSubmittable(tx, requisitionId);
    await assertCanSubmit(tx, req.requesterId, actorUserId);
    const chain = await buildApprovalChain(tx, req, total);
    await persistSubmission(tx, requisitionId, chain, total, actorUserId);
    await emitApprovalRequests(tx, req, chain, total);
    return { status: "SUBMITTED" as const, totalMinor: total, steps: chain.length };
  });
}

async function loadDecidableApproval(tx: Tx, approvalId: string, actorUserId: string) {
  const [actor] = await tx.select().from(users).where(eq(users.id, actorUserId));
  if (!actor) throw new DomainError("NOT_FOUND", "Actor not found");

  const [approval] = await tx.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!approval) throw new DomainError("NOT_FOUND", "Approval not found");

  if (actor.role !== approval.approverRole && actor.role !== "ADMIN") {
    throw new DomainError("FORBIDDEN", `Requires ${approval.approverRole} role`);
  }
  if (approval.decision) {
    throw new DomainError("INVALID_STATE", "Approval already decided");
  }
  return approval;
}

async function notifyRequester(tx: Tx, requisitionId: string, outcome: "APPROVED" | "REJECTED") {
  const [req] = await tx.select().from(requisitions).where(eq(requisitions.id, requisitionId));
  if (!req) return;
  const [requester] = await tx.select().from(users).where(eq(users.id, req.requesterId));
  if (!requester) return;
  await tx.insert(integrationEvents).values({
    eventType: "REQUISITION_DECIDED",
    payload: { to: [requester.email], requisitionId, decision: outcome },
  });
}

async function rejectApproval(
  tx: Tx,
  approval: Approval,
  actorUserId: string,
  comment: string | undefined,
) {
  await tx.update(approvals).set({ decision: "REJECT", decidedByUserId: actorUserId, comment, decidedAt: new Date() }).where(eq(approvals.id, approval.id));
  await tx.update(requisitions).set({ status: "REJECTED" }).where(eq(requisitions.id, approval.requisitionId));
  await audit(tx, "requisition", approval.requisitionId, "REJECTED", actorUserId);
  await notifyRequester(tx, approval.requisitionId, "REJECTED");
  return { requisitionStatus: "REJECTED" as const };
}

async function approveStep(
  tx: Tx,
  approval: Approval,
  actorUserId: string,
  comment: string | undefined,
) {
  await tx.update(approvals).set({ decision: "APPROVE", decidedByUserId: actorUserId, comment, decidedAt: new Date() }).where(eq(approvals.id, approval.id));

  const remaining = await tx
    .select()
    .from(approvals)
    .where(and(eq(approvals.requisitionId, approval.requisitionId), eq(approvals.decision, "APPROVE")));
  const all = await tx
    .select()
    .from(approvals)
    .where(eq(approvals.requisitionId, approval.requisitionId));

  if (remaining.length !== all.length) return { requisitionStatus: "SUBMITTED" as const };
  await tx.update(requisitions).set({ status: "APPROVED" }).where(eq(requisitions.id, approval.requisitionId));
  await audit(tx, "requisition", approval.requisitionId, "APPROVED", actorUserId);
  await notifyRequester(tx, approval.requisitionId, "APPROVED");
  return { requisitionStatus: "APPROVED" as const };
}

export async function decideApproval(
  approvalId: string,
  actorUserId: string,
  decision: "approve" | "reject",
  comment?: string,
) {
  return db.transaction(async (tx) => {
    const approval = await loadDecidableApproval(tx, approvalId, actorUserId);
    return decision === "reject"
      ? rejectApproval(tx, approval, actorUserId, comment)
      : approveStep(tx, approval, actorUserId, comment);
  });
}
