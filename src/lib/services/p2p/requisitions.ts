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

export async function submitRequisition(requisitionId: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, requisitionId));
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

    const rules = await tx
      .select()
      .from(approvalRules)
      .where(eq(approvalRules.currency, req.currency))
      .orderBy(asc(approvalRules.sequence));
    if (rules.length === 0) {
      throw new DomainError("INVALID_STATE", "No approval rules configured");
    }

    const chain = resolveApprovalChain(Money.of(total, req.currency), rules.map((r) => ({
      id: r.id,
      minAmount: Money.of(r.minMinor, r.currency),
      maxAmount: r.maxMinor === null ? undefined : Money.of(r.maxMinor, r.currency),
      approverRole: r.approverRole,
    })));

    await tx.insert(approvals).values(
      chain.map((step, i) => ({
        requisitionId,
        ruleId: step.ruleId,
        approverRole: step.approverRole,
        sequence: i,
      })),
    );
    await tx
      .update(requisitions)
      .set({ status: "SUBMITTED" })
      .where(eq(requisitions.id, requisitionId));
    await audit(tx, "requisition", requisitionId, "SUBMITTED", actorUserId, { total });

    const [supplierRow] = await tx.select().from(suppliers).where(eq(suppliers.id, req.supplierId));
    const roleUsers = await tx.select({ email: users.email, role: users.role }).from(users);
    for (const step of chain) {
      const recipients = roleUsers.filter((u) => u.role === step.approverRole).map((u) => u.email);
      if (recipients.length === 0) continue;
      await tx.insert(integrationEvents).values({
        eventType: "APPROVAL_REQUESTED",
        payload: {
          to: recipients,
          requisitionId,
          supplier: supplierRow?.name ?? "",
          totalMinor: total,
          currency: req.currency,
        },
      });
    }

    return { status: "SUBMITTED" as const, totalMinor: total, steps: chain.length };
  });
}

export async function decideApproval(
  approvalId: string,
  actorUserId: string,
  decision: "approve" | "reject",
  comment?: string,
) {
  return db.transaction(async (tx) => {
    const [actor] = await tx.select().from(users).where(eq(users.id, actorUserId));
    if (!actor) throw new DomainError("NOT_FOUND", "Actor not found");

    const [approval] = await tx.select().from(approvals).where(eq(approvals.id, approvalId));
    if (!approval) throw new DomainError("NOT_FOUND", "Approval not found");

    const isAuthorized =
      actor.role === approval.approverRole || actor.role === "ADMIN";
    if (!isAuthorized) {
      throw new DomainError("FORBIDDEN", `Requires ${approval.approverRole} role`);
    }
    if (approval.decision) {
      throw new DomainError("INVALID_STATE", "Approval already decided");
    }
    async function notifyRequester(tx2: Tx, outcome: "APPROVED" | "REJECTED") {
      const [req] = await tx2.select().from(requisitions).where(eq(requisitions.id, approval.requisitionId));
      if (!req) return;
      const [requester] = await tx2.select().from(users).where(eq(users.id, req.requesterId));
      if (!requester) return;
      await tx2.insert(integrationEvents).values({
        eventType: "REQUISITION_DECIDED",
        payload: { to: [requester.email], requisitionId: approval.requisitionId, decision: outcome },
      });
    }

    if (decision === "reject") {
      await tx.update(approvals).set({ decision: "REJECT", decidedByUserId: actorUserId, comment, decidedAt: new Date() }).where(eq(approvals.id, approvalId));
      await tx.update(requisitions).set({ status: "REJECTED" }).where(eq(requisitions.id, approval.requisitionId));
      await audit(tx, "requisition", approval.requisitionId, "REJECTED", actorUserId);
      await notifyRequester(tx, "REJECTED");
      return { requisitionStatus: "REJECTED" as const };
    }

    await tx.update(approvals).set({ decision: "APPROVE", decidedByUserId: actorUserId, comment, decidedAt: new Date() }).where(eq(approvals.id, approvalId));

    const remaining = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.requisitionId, approval.requisitionId), eq(approvals.decision, "APPROVE")));
    const all = await tx
      .select()
      .from(approvals)
      .where(eq(approvals.requisitionId, approval.requisitionId));

    let requisitionStatus: "SUBMITTED" | "APPROVED" = "SUBMITTED";
    if (remaining.length === all.length) {
      await tx.update(requisitions).set({ status: "APPROVED" }).where(eq(requisitions.id, approval.requisitionId));
      requisitionStatus = "APPROVED";
      await audit(tx, "requisition", approval.requisitionId, "APPROVED", actorUserId);
      await notifyRequester(tx, "APPROVED");
    }
    return { requisitionStatus };
  });
}
