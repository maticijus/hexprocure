import { describe, it, expect, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  approvals,
  invoiceLines,
  invoices,
  purchaseOrders,
  requisitionLines,
  requisitions,
} from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import {
  submitRequisition,
  decideApproval,
  createPurchaseOrder,
  cancelPurchaseOrder,
  addReceipt,
  createInvoice,
  matchInvoiceById,
  approveInvoice,
} from "@/lib/services/p2p";

type LineSpec = {
  quantity: number;
  unitPriceMinor: number;
  kind?: "GOODS" | "SERVICE";
};

beforeEach(async () => {
  await truncateAll();
});

type Org = Awaited<ReturnType<typeof seedOrg>>;

async function approvedRequisition(lines: LineSpec[], org?: Org) {
  const s = org ?? (await seedOrg());
  const [req] = await db
    .insert(requisitions)
    .values({
      requesterId: s.requester.id,
      supplierId: s.supplier.id,
      costCenterId: s.cc.id,
    })
    .returning();
  await db
    .insert(requisitionLines)
    .values(
      lines.map((l, i) => ({
        requisitionId: req.id,
        description: `Line ${i}`,
        ...l,
      })),
    );
  await submitRequisition(req.id, s.requester.id);
  for (const a of await db
    .select()
    .from(approvals)
    .where(eq(approvals.requisitionId, req.id))) {
    await decideApproval(
      a.id,
      a.approverRole === "FINANCE" ? s.finance.id : s.manager.id,
      "approve",
    );
  }
  return { s, req };
}

async function countPos(requisitionId: string) {
  const { rows } = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM purchase_orders WHERE requisition_id = ${requisitionId}`,
  );
  return (rows[0] as { n: number }).n;
}

async function openPo(lines: LineSpec[], org?: Org) {
  const { s, req } = await approvedRequisition(lines, org);
  const { purchaseOrderId } = await createPurchaseOrder(req.id, s.manager.id);
  const { rows } = await db.execute(
    sql`SELECT id, kind FROM po_lines WHERE purchase_order_id = ${purchaseOrderId}`,
  );
  const poLines = rows as { id: string; kind: "GOODS" | "SERVICE" }[];
  return {
    s,
    purchaseOrderId,
    goods: poLines.find((l) => l.kind === "GOODS")!,
    service: poLines.find((l) => l.kind === "SERVICE"),
  };
}

async function matchedGoodsInvoice() {
  const { s, purchaseOrderId, goods } = await openPo([
    { quantity: 2, unitPriceMinor: 1000 },
  ]);
  await addReceipt(
    purchaseOrderId,
    [{ poLineId: goods.id, quantityReceived: 2 }],
    s.requester.id,
  );
  const invoice = await createInvoice(
    {
      supplierId: s.supplier.id,
      purchaseOrderId,
      number: "INV-B2",
      lines: [{ poLineId: goods.id, quantity: 2, unitPriceMinor: 1000 }],
    },
    s.finance.id,
  );
  expect((await matchInvoiceById(invoice.id, s.finance.id)).status).toBe(
    "MATCHED",
  );
  return { s, invoice };
}

async function approvedEvents() {
  const { rows } = await db.execute(
    sql`SELECT payload FROM integration_events WHERE event_type = 'INVOICE_APPROVED'`,
  );
  return rows as { payload: { currency: string; totalMinor: unknown } }[];
}

describe("B1 requisition can be ordered once", () => {
  it("marks the requisition ORDERED and rejects a second order with INVALID_STATE", async () => {
    const { s, req } = await approvedRequisition([
      { quantity: 2, unitPriceMinor: 1000 },
    ]);
    await createPurchaseOrder(req.id, s.manager.id);

    const [after] = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, req.id));
    expect(after.status).toBe("ORDERED");
    await expect(
      createPurchaseOrder(req.id, s.manager.id),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(await countPos(req.id)).toBe(1);
  });

  it("two concurrent orders produce exactly one PO", async () => {
    const { s, req } = await approvedRequisition([
      { quantity: 2, unitPriceMinor: 1000 },
    ]);
    const results = await Promise.allSettled([
      createPurchaseOrder(req.id, s.manager.id),
      createPurchaseOrder(req.id, s.manager.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "INVALID_STATE" });
    expect(await countPos(req.id)).toBe(1);
  });
});

describe("B2 invoice approval is idempotent under concurrency", () => {
  it("two concurrent approvals emit exactly one INVOICE_APPROVED event", async () => {
    const { s, invoice } = await matchedGoodsInvoice();
    const results = await Promise.allSettled([
      approveInvoice(invoice.id, s.finance.id),
      approveInvoice(invoice.id, s.finance.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "INVALID_STATE" });
    expect(await approvedEvents()).toHaveLength(1);
  });
});

describe("B3 INVOICE_APPROVED carries PO currency and the billed total", () => {
  it("uses the PO currency and service amountMinor in an integer total", async () => {
    const { s, purchaseOrderId, goods, service } = await openPo([
      { quantity: 2, unitPriceMinor: 1000 },
      { quantity: 1, unitPriceMinor: 50_000, kind: "SERVICE" },
    ]);
    await db.execute(
      sql`UPDATE purchase_orders SET currency = 'CZK' WHERE id = ${purchaseOrderId}`,
    );
    await addReceipt(
      purchaseOrderId,
      [
        { poLineId: goods.id, quantityReceived: 2 },
        { poLineId: service!.id, quantityReceived: 1, accepted: true },
      ],
      s.requester.id,
    );
    const invoice = await createInvoice(
      {
        supplierId: s.supplier.id,
        purchaseOrderId,
        number: "INV-B3",
        lines: [
          { poLineId: goods.id, quantity: 2, unitPriceMinor: 1000 },
          {
            poLineId: service!.id,
            quantity: 1,
            unitPriceMinor: 0,
            amountMinor: 40_000,
          },
        ],
      },
      s.finance.id,
    );
    expect((await matchInvoiceById(invoice.id, s.finance.id)).status).toBe(
      "MATCHED",
    );
    await approveInvoice(invoice.id, s.finance.id);

    const [event] = await approvedEvents();
    expect(event.payload.currency).toBe("CZK");
    expect(event.payload.totalMinor).toBe(42_000);
  });
});

describe("B3 follow-up: goods totals ignore unchecked amountMinor", () => {
  it("bills goods lines at quantity * unit price even when amountMinor is set", async () => {
    const { s, purchaseOrderId, goods } = await openPo([{ quantity: 2, unitPriceMinor: 1000 }]);
    await addReceipt(purchaseOrderId, [{ poLineId: goods.id, quantityReceived: 2 }], s.requester.id);
    const invoice = await createInvoice(
      {
        supplierId: s.supplier.id,
        purchaseOrderId,
        number: "INV-B3G",
        lines: [{ poLineId: goods.id, quantity: 2, unitPriceMinor: 1000, amountMinor: 99_999 }],
      },
      s.finance.id,
    );
    expect((await matchInvoiceById(invoice.id, s.finance.id)).status).toBe("MATCHED");
    await approveInvoice(invoice.id, s.finance.id);

    const [event] = await approvedEvents();
    expect(event.payload.totalMinor).toBe(2000);
  });
});

describe("B4 invoice lines must belong to the invoiced PO", () => {
  async function twoPos() {
    const a = await openPo([{ quantity: 2, unitPriceMinor: 1000 }]);
    const b = await openPo([{ quantity: 2, unitPriceMinor: 1000 }], a.s);
    return { s: a.s, poA: a.purchaseOrderId, foreignLineId: b.goods.id };
  }

  it("createInvoice rejects a line id from another PO with VALIDATION", async () => {
    const { s, poA, foreignLineId } = await twoPos();
    await expect(
      createInvoice(
        {
          supplierId: s.supplier.id,
          purchaseOrderId: poA,
          number: "INV-B4",
          lines: [
            { poLineId: foreignLineId, quantity: 1, unitPriceMinor: 1000 },
          ],
        },
        s.finance.id,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("matching treats a foreign PO line as unmatched", async () => {
    const { s, poA, foreignLineId } = await twoPos();
    const [invoice] = await db
      .insert(invoices)
      .values({
        supplierId: s.supplier.id,
        purchaseOrderId: poA,
        number: "INV-B4M",
      })
      .returning();
    await db
      .insert(invoiceLines)
      .values({
        invoiceId: invoice.id,
        poLineId: foreignLineId,
        quantity: 1,
        unitPriceMinor: 1000,
      });

    const result = await matchInvoiceById(invoice.id, s.finance.id);
    expect(result.status).toBe("EXCEPTION");
    expect(result.exceptions).toEqual([
      expect.objectContaining({ type: "UNMATCHED_LINE" }),
    ]);
  });
});

describe("B5 invoiced quantity is capped at received across invoices", () => {
  it("10 ordered, 5 received: first invoice of 5 matches, second raises QUANTITY_MISMATCH", async () => {
    const { s, purchaseOrderId, goods } = await openPo([{ quantity: 10, unitPriceMinor: 1000 }]);
    await addReceipt(purchaseOrderId, [{ poLineId: goods.id, quantityReceived: 5 }], s.requester.id);
    const invoiceOf5 = (number: string) =>
      createInvoice(
        {
          supplierId: s.supplier.id,
          purchaseOrderId,
          number,
          lines: [{ poLineId: goods.id, quantity: 5, unitPriceMinor: 1000 }],
        },
        s.finance.id,
      );

    const first = await invoiceOf5("INV-B5-1");
    expect((await matchInvoiceById(first.id, s.finance.id)).status).toBe("MATCHED");
    const second = await invoiceOf5("INV-B5-2");
    const result = await matchInvoiceById(second.id, s.finance.id);
    expect(result.status).toBe("EXCEPTION");
    expect(result.exceptions).toEqual([expect.objectContaining({ type: "QUANTITY_MISMATCH" })]);
  });
});

describe("B7 receipts cannot exceed ordered quantity", () => {
  async function receivedQty(poLineId: string) {
    const { rows } = await db.execute(
      sql`SELECT COALESCE(SUM(quantity_received), 0)::int AS n FROM receipt_lines WHERE po_line_id = ${poLineId}`,
    );
    return (rows[0] as { n: number }).n;
  }

  it("merges duplicate line ids in one request before checking ordered", async () => {
    const { s, purchaseOrderId, goods } = await openPo([{ quantity: 10, unitPriceMinor: 1000 }]);
    const sixTwice = [
      { poLineId: goods.id, quantityReceived: 6 },
      { poLineId: goods.id, quantityReceived: 6 },
    ];
    await expect(addReceipt(purchaseOrderId, sixTwice, s.requester.id)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(await receivedQty(goods.id)).toBe(0);
  });

  it("concurrent receipts of 6 against 10 ordered: one succeeds, total stays within ordered", async () => {
    const { s, purchaseOrderId, goods } = await openPo([{ quantity: 10, unitPriceMinor: 1000 }]);
    const receiveSix = () =>
      addReceipt(purchaseOrderId, [{ poLineId: goods.id, quantityReceived: 6 }], s.requester.id);
    // Open the connections first so connection setup does not serialize the race.
    await Promise.all(Array.from({ length: 4 }, () => pool.query("SELECT pg_sleep(0.05)")));
    const results = await Promise.allSettled(Array.from({ length: 4 }, receiveSix));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "INVALID_STATE" });
    }
    expect(await receivedQty(goods.id)).toBe(6);
  });
});

describe("M1 cancelling a PO releases its requisition", () => {
  it("cancel then createPurchaseOrder again succeeds", async () => {
    const { s, req } = await approvedRequisition([{ quantity: 2, unitPriceMinor: 1000 }]);
    const first = await createPurchaseOrder(req.id, s.manager.id);
    await cancelPurchaseOrder(first.purchaseOrderId, s.manager.id);

    const [after] = await db.select().from(requisitions).where(eq(requisitions.id, req.id));
    expect(after.status).toBe("APPROVED");
    const second = await createPurchaseOrder(req.id, s.manager.id);
    expect(second.purchaseOrderId).not.toBe(first.purchaseOrderId);
  });

  it("two concurrent cancels yield one success and one INVALID_STATE", async () => {
    const { s, req } = await approvedRequisition([{ quantity: 2, unitPriceMinor: 1000 }]);
    const { purchaseOrderId } = await createPurchaseOrder(req.id, s.manager.id);
    const results = await Promise.allSettled([
      cancelPurchaseOrder(purchaseOrderId, s.manager.id),
      cancelPurchaseOrder(purchaseOrderId, s.manager.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("M5 duplicate PO for one requisition", () => {
  it("maps the unique violation to INVALID_STATE", async () => {
    const { s, req } = await approvedRequisition([{ quantity: 2, unitPriceMinor: 1000 }]);
    await db.insert(purchaseOrders).values({
      requisitionId: req.id,
      supplierId: s.supplier.id,
      costCenterId: s.cc.id,
      currency: "EUR",
    });

    await expect(createPurchaseOrder(req.id, s.manager.id)).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "Requisition already ordered",
    });
  });
});

describe("M3 only committed invoices count as previously invoiced", () => {
  async function priorInvoice(
    status: "MATCHED" | "EXCEPTION",
    kind: "GOODS" | "SERVICE",
  ) {
    const { s, purchaseOrderId, goods, service } = await openPo([
      kind === "GOODS"
        ? { quantity: 10, unitPriceMinor: 1000 }
        : { quantity: 1, unitPriceMinor: 5000, kind: "SERVICE" },
    ]);
    const line = kind === "GOODS" ? goods : service!;
    await addReceipt(
      purchaseOrderId,
      [{ poLineId: line.id, quantityReceived: kind === "GOODS" ? 10 : 0, accepted: true }],
      s.requester.id,
    );
    const [prior] = await db
      .insert(invoices)
      .values({ supplierId: s.supplier.id, purchaseOrderId, number: "INV-M3-PRIOR", status })
      .returning();
    const qty = kind === "GOODS" ? 10 : 1;
    const unit = kind === "GOODS" ? 1000 : 5000;
    await db.insert(invoiceLines).values({
      invoiceId: prior.id,
      poLineId: line.id,
      quantity: qty,
      unitPriceMinor: unit,
      amountMinor: kind === "SERVICE" ? 5000 : null,
    });
    const next = await createInvoice(
      {
        supplierId: s.supplier.id,
        purchaseOrderId,
        number: "INV-M3-NEXT",
        lines: [
          {
            poLineId: line.id,
            quantity: qty,
            unitPriceMinor: unit,
            amountMinor: kind === "SERVICE" ? 5000 : undefined,
          },
        ],
      },
      s.finance.id,
    );
    return matchInvoiceById(next.id, s.finance.id);
  }

  it.each(["GOODS", "SERVICE"] as const)("%s: a prior EXCEPTION invoice does not block a correct one", async (kind) => {
    expect((await priorInvoice("EXCEPTION", kind)).status).toBe("MATCHED");
  });

  it.each(["GOODS", "SERVICE"] as const)("%s: a prior MATCHED invoice still counts", async (kind) => {
    expect((await priorInvoice("MATCHED", kind)).status).toBe("EXCEPTION");
  });
});

describe("M2 service invoices need an accepted receipt", () => {
  async function serviceInvoice(accept: boolean) {
    const { s, purchaseOrderId, service } = await openPo([
      { quantity: 1, unitPriceMinor: 5000, kind: "SERVICE" },
    ]);
    if (accept) {
      await addReceipt(
        purchaseOrderId,
        [{ poLineId: service!.id, quantityReceived: 0, accepted: true }],
        s.requester.id,
      );
    }
    const invoice = await createInvoice(
      {
        supplierId: s.supplier.id,
        purchaseOrderId,
        number: "INV-M2",
        lines: [{ poLineId: service!.id, quantity: 1, unitPriceMinor: 5000, amountMinor: 5000 }],
      },
      s.finance.id,
    );
    return matchInvoiceById(invoice.id, s.finance.id);
  }

  it("raises SERVICE_NOT_ACCEPTED when the service was never accepted", async () => {
    const result = await serviceInvoice(false);
    expect(result.status).toBe("EXCEPTION");
    expect(result.exceptions).toEqual([expect.objectContaining({ type: "SERVICE_NOT_ACCEPTED" })]);
  });

  it("matches once the service is accepted", async () => {
    expect((await serviceInvoice(true)).status).toBe("MATCHED");
  });
});
