import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db, pool } from "@/lib/db";
import { poLines, purchaseOrders } from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import { DomainError } from "@/lib/services/p2p";

const extractMock = vi.hoisted(() => vi.fn());
const llmExtractMock = vi.hoisted(() => vi.fn());
const recordUsageMock = vi.hoisted(() => vi.fn());
const useFakeLlm = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/integrations/llm-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/llm-provider")>();
  return {
    ...actual,
    getLlmProvider: () =>
      useFakeLlm.on ? { name: "fake", extractInvoiceLines: llmExtractMock } : new actual.NoopLlmProvider(),
  };
});

vi.mock("@/lib/integrations/llm-usage", () => ({ recordLlmUsage: recordUsageMock }));

vi.mock("@/lib/api/helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/helpers")>();
  return {
    ...actual,
    getActor: vi.fn().mockResolvedValue({ id: "u1", role: "FINANCE" }),
  };
});

vi.mock("@/lib/integrations/ocr-provider", () => ({
  PaddleOcrProvider: class {
    extract = extractMock;
    constructor(url?: string) {
      void url;
    }
  },
}));

import { POST } from "@/app/api/v1/invoices/extract/route";

beforeEach(async () => {
  extractMock.mockReset();
  llmExtractMock.mockReset();
  recordUsageMock.mockReset();
  useFakeLlm.on = false;
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

async function seedPo() {
  const s = await seedOrg();
  const [po] = await db
    .insert(purchaseOrders)
    .values({ supplierId: s.supplier.id, costCenterId: s.cc.id, currency: "EUR" })
    .returning();
  const [line] = await db
    .insert(poLines)
    .values({ purchaseOrderId: po.id, description: "Laptop stand", quantityOrdered: 2, unitPriceMinor: 12_345 })
    .returning();
  return { po, line };
}

function post(purchaseOrderId?: string) {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("%PDF-1.4 fake")]), "invoice.pdf");
  if (purchaseOrderId) form.append("purchaseOrderId", purchaseOrderId);
  return POST(new Request("http://x", { method: "POST", body: form }));
}

describe("POST /api/v1/invoices/extract", () => {
  it("returns 501 when OCR sidecar is not configured", async () => {
    const original = process.env.INTEGRATION_OCR_URL;
    delete process.env.INTEGRATION_OCR_URL;
    const form = new FormData();
    form.append("file", new Blob(["x"]), "a.pdf");
    const res = await POST(new Request("http://x", { method: "POST", body: form }));
    expect(res.status).toBe(501);
    if (original === undefined) delete process.env.INTEGRATION_OCR_URL;
    else process.env.INTEGRATION_OCR_URL = original;
  });

  it("returns a parsed draft from OCR text", async () => {
    process.env.INTEGRATION_OCR_URL = "http://fake:8100";
    extractMock.mockResolvedValue({
      text:
        "Acme GmbH\nRechnung ACME-9\nInvoice Date: 2026-08-14\nTotal Amount: EUR 2,055.00",
      lines: [],
    });

    const form = new FormData();
    form.append("file", new Blob([Buffer.from("%PDF-1.4 fake")]), "invoice.pdf");
    const res = await POST(new Request("http://x", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.draft.invoiceNumber).toBe("ACME-9");
    expect(data.draft.totalMinor).toBe(205_500);
    expect(data.rawText).toContain("Acme");
    expect(extractMock).toHaveBeenCalledTimes(1);
  });

  it("rejects requests without a file field", async () => {
    process.env.INTEGRATION_OCR_URL = "http://fake:8100";
    const form = new FormData();
    const res = await POST(new Request("http://x", { method: "POST", body: form }));
    expect(res.status).toBe(400);
    expect(extractMock).not.toHaveBeenCalled();
  });

  describe("line extraction", () => {
    beforeEach(() => {
      process.env.INTEGRATION_OCR_URL = "http://fake:8100";
      extractMock.mockResolvedValue({ text: "Rechnung ACME-9\n2 x Laptop stand 123,45 246,90", lines: [] });
    });

    it("returns Noop result as linesSource none", async () => {
      const data = await (await post()).json();
      expect(data.linesSource).toBe("none");
      expect(data.lines).toEqual([]);
      expect(recordUsageMock).not.toHaveBeenCalled();
    });

    it("returns normalised lines mapped to the PO and logs usage", async () => {
      const { po, line } = await seedPo();
      useFakeLlm.on = true;
      llmExtractMock.mockResolvedValue({
        lines: [{ description: "Laptop stand", quantity: 2, unitPrice: "123,45", lineTotal: "246,90", poLineRef: line.id }],
        usage: { inputTokens: 10, outputTokens: 5, model: "m" },
      });
      const res = await post(po.id);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.linesSource).toBe("llm");
      expect(data.lines[0]).toMatchObject({ poLineId: line.id, unitPriceMinor: 12_345, amountMinor: 24_690, confidence: "HIGH" });
      expect(llmExtractMock.mock.calls[0][0].poLines[0]).toMatchObject({ id: line.id, quantityOrdered: 2 });
      expect(recordUsageMock).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "invoice_lines", inputTokens: 10, outputTokens: 5, actorUserId: "u1" }),
      );
    });

    it("works without a purchaseOrderId", async () => {
      useFakeLlm.on = true;
      llmExtractMock.mockResolvedValue({ lines: [], usage: { inputTokens: 1, outputTokens: 1, model: "m" } });
      const data = await (await post()).json();
      expect(llmExtractMock.mock.calls[0][0].poLines).toEqual([]);
      expect(data.linesSource).toBe("llm");
    });

    it("still returns the header draft with a warning when the LLM is unavailable", async () => {
      useFakeLlm.on = true;
      llmExtractMock.mockRejectedValue(new DomainError("LLM_UNAVAILABLE", "LLM rate limit reached"));
      const res = await post();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.draft.invoiceNumber).toBe("ACME-9");
      expect(data.lines).toEqual([]);
      expect(data.linesSource).toBe("none");
      expect(data.warnings).toEqual(["LLM unavailable: LLM rate limit reached"]);
      expect(recordUsageMock).toHaveBeenCalledWith(
        expect.objectContaining({ inputTokens: 0, outputTokens: 0, error: "LLM rate limit reached" }),
      );
    });

    it("truncates oversized invoice text and warns", async () => {
      extractMock.mockResolvedValue({ text: "x".repeat(70_000), lines: [] });
      useFakeLlm.on = true;
      llmExtractMock.mockResolvedValue({ lines: [], usage: { inputTokens: 1, outputTokens: 1, model: "m" } });
      const data = await (await post()).json();
      expect(llmExtractMock.mock.calls[0][0].text).toHaveLength(60_000);
      expect(data.warnings).toEqual(["invoice text truncated to 60000 characters"]);
      expect(data.linesSource).toBe("llm");
    });

    it("does not fail the request when usage logging fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      recordUsageMock.mockRejectedValue(new Error("db down"));
      useFakeLlm.on = true;
      llmExtractMock.mockResolvedValue({
        lines: [{ description: "Widget", quantity: 1, unitPrice: "1,00", lineTotal: null, poLineRef: null }],
        usage: { inputTokens: 1, outputTokens: 1, model: "m" },
      });
      const res = await post();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.lines).toHaveLength(1);
      expect(data.linesSource).toBe("llm");
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("does not fail the request when usage logging fails after an LLM error", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      recordUsageMock.mockRejectedValue(new Error("db down"));
      useFakeLlm.on = true;
      llmExtractMock.mockRejectedValue(new DomainError("LLM_UNAVAILABLE", "LLM rate limit reached"));
      const res = await post();
      expect(res.status).toBe(200);
      expect((await res.json()).warnings).toEqual(["LLM unavailable: LLM rate limit reached"]);
      errorSpy.mockRestore();
    });

    it("returns 404 for an unknown purchaseOrderId", async () => {
      useFakeLlm.on = true;
      const res = await post(randomUUID());
      expect(res.status).toBe(404);
      expect(llmExtractMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a malformed purchaseOrderId", async () => {
      useFakeLlm.on = true;
      expect((await post("not-a-uuid")).status).toBe(400);
    });
  });
});
