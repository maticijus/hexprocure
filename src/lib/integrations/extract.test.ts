import { describe, it, expect, vi, beforeEach } from "vitest";

const extractMock = vi.hoisted(() => vi.fn());

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

beforeEach(() => {
  extractMock.mockReset();
});

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
});
