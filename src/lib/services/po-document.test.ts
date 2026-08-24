import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { suppliers, auditEvents } from "@/lib/db/schema";
import { seedOrg, createRequisitionWithLine, truncateAll } from "@/lib/testing/seed";
import {
  submitRequisition,
  decideApproval,
  createPurchaseOrder,
  cancelPurchaseOrder,
  DomainError,
} from "./p2p";
import { buildPurchaseOrderPdf, sendPurchaseOrder, toPdfData } from "./po-document";

beforeEach(async () => {
  await truncateAll();
});

async function approvedPoId(s = seedOrg()) {
  const org = await s;
  const req = await createRequisitionWithLine(
    org.requester.id,
    org.supplier.id,
    org.cc.id,
    4,
    44900,
  );
  await submitRequisition(req.id, org.requester.id);
  const approvalRows = (
    await db.execute(sql`SELECT id, approver_role FROM approvals ORDER BY sequence`)
  ).rows as { id: string; approver_role: string }[];
  for (const a of approvalRows) {
    const decider = a.approver_role === "FINANCE" ? org.finance.id : org.manager.id;
    await decideApproval(a.id, decider, "approve");
  }
  const po = await createPurchaseOrder(req.id, org.manager.id);
  return { org, poId: po.purchaseOrderId, totalMinor: po.totalMinor };
}


describe("toPdfData", () => {
  it("includes cost center and requester on the internal variant", async () => {
    const { org, poId } = await approvedPoId();
    const data = await toPdfData(poId, false);
    expect(data.poReference).toBe(poId);
    expect(data.supplierName).toBe(org.supplier.name);
    expect(data.costCenter).toBe(org.cc.name);
    expect(data.requesterName).toBe(org.requester.name);
    expect(data.currency).toBe("EUR");
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0]).toMatchObject({
      description: "Test items",
      quantity: 4,
      unitPriceMinor: 44900,
      totalMinor: 179600,
    });
    expect(data.totalMinor).toBe(179600);
  });

  it("omits internal fields on the supplier variant", async () => {
    const data = await toPdfData((await approvedPoId()).poId, true);
    expect(data.costCenter).toBeUndefined();
    expect(data.requesterName).toBeUndefined();
    expect(data.supplierName).toBeTruthy();
  });
});

describe("buildPurchaseOrderPdf", () => {
  it("renders deterministic non-empty PDF bytes starting with %PDF", async () => {
    const { poId } = await approvedPoId();
    const a = await buildPurchaseOrderPdf(poId, false);
    const b = await buildPurchaseOrderPdf(poId, false);
    expect(a.subarray(0, 5).toString()).toBe("%PDF-");
    expect(a.length).toBeGreaterThan(500);
    expect(a.equals(b)).toBe(true);
  }, 30_000);

  it("supplier variant differs from internal variant", async () => {
    const { poId } = await approvedPoId();
    const internal = await buildPurchaseOrderPdf(poId, false);
    const supplier = await buildPurchaseOrderPdf(poId, true);
    expect(internal.equals(supplier)).toBe(false);
  }, 30_000);

  it("throws NOT_FOUND for unknown PO", async () => {
    await expect(
      buildPurchaseOrderPdf("00000000-0000-0000-0000-000000000000", false),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("sendPurchaseOrder", () => {
  it("sends the PDF to the supplier email by default and audits PO_SENT", async () => {
    const { org, poId } = await approvedPoId();
    const transport = vi.fn().mockResolvedValue({ messageId: "m1" });

    const result = await sendPurchaseOrder(poId, org.manager.id, undefined, transport);

    expect(result.sentTo).toEqual([org.supplier.email]);
    expect(transport).toHaveBeenCalledOnce();
    const mail = transport.mock.calls[0][0];
    expect(mail.subject).toContain(poId.slice(0, 8));
    expect(mail.attachments?.[0].contentType).toBe("application/pdf");

    const audits = await db.select().from(auditEvents);
    expect(audits.some((a) => a.action === "PO_SENT")).toBe(true);
  });

  it("overrides the recipient when 'to' is provided", async () => {
    const { poId, org } = await approvedPoId();
    const transport = vi.fn().mockResolvedValue({});
    const result = await sendPurchaseOrder(poId, org.manager.id, "buyer@vendor.com", transport);
    expect(result.sentTo).toEqual(["buyer@vendor.com"]);
  });

  it("allows re-sending an OPEN PO and audits each send", async () => {
    const { poId, org } = await approvedPoId();
    const transport = vi.fn().mockResolvedValue({});
    await sendPurchaseOrder(poId, org.manager.id, undefined, transport);
    await sendPurchaseOrder(poId, org.manager.id, undefined, transport);
    const sends = (await db.select().from(auditEvents)).filter((a) => a.action === "PO_SENT");
    expect(sends).toHaveLength(2);
  });

  it("refuses to send a CANCELLED PO", async () => {
    const { poId, org } = await approvedPoId();
    await cancelPurchaseOrder(poId, org.manager.id);
    const transport = vi.fn().mockResolvedValue({});
    await expect(
      sendPurchaseOrder(poId, org.manager.id, undefined, transport),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("fails cleanly when no recipient can be resolved", async () => {
    const { org, poId } = await approvedPoId();
    await db
      .update(suppliers)
      .set({ email: null })
      .where(eq(suppliers.id, org.supplier.id));
    const transport = vi.fn();

    await expect(
      sendPurchaseOrder(poId, org.manager.id, undefined, transport),
    ).rejects.toBeInstanceOf(DomainError);
    expect(transport).not.toHaveBeenCalled();
  });
});

afterAll(async () => {
  await pool.end();
});
