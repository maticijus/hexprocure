import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { poLines, purchaseOrders } from "@/lib/db/schema";
import { PaddleOcrProvider } from "@/lib/integrations/ocr-provider";
import { parseInvoiceText } from "@/lib/integrations/invoice-parser";
import { getLlmProvider, NoopLlmProvider } from "@/lib/integrations/llm-provider";
import { recordLlmUsage, type LlmUsageEntry } from "@/lib/integrations/llm-usage";
import { normaliseExtractedLines, type PoLineContext, type ProposedInvoiceLine } from "@/domain/invoice-lines";
import { DomainError } from "@/lib/services/p2p";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export const maxDuration = 60;

const MAX_LLM_TEXT_CHARS = 60_000;

async function logUsage(entry: LlmUsageEntry): Promise<void> {
  try {
    await recordLlmUsage(entry);
  } catch (error) {
    console.error("Failed to record llm_usage", error);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadPoContext(purchaseOrderId: string): Promise<{ currency: string; lines: PoLineContext[] }> {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId));
  if (!po) throw new DomainError("NOT_FOUND", "Purchase order not found");
  const rows = await db.select().from(poLines).where(eq(poLines.purchaseOrderId, purchaseOrderId));
  return {
    currency: po.currency,
    lines: rows.map((r) => ({
      id: r.id,
      description: r.description,
      quantityOrdered: r.quantityOrdered,
      unitPriceMinor: r.unitPriceMinor,
      kind: r.kind,
    })),
  };
}

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    const ocrUrl = process.env.INTEGRATION_OCR_URL;
    if (!ocrUrl) {
      return NextResponse.json(
        { error: { code: "NOT_CONFIGURED", message: "Set INTEGRATION_OCR_URL to enable OCR intake" } },
        { status: 501 },
      );
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "multipart field 'file' is required" } },
        { status: 400 },
      );
    }
    const rawPoId = form.get("purchaseOrderId");
    const purchaseOrderId = typeof rawPoId === "string" && rawPoId !== "" ? rawPoId : null;
    if (purchaseOrderId !== null && !UUID_RE.test(purchaseOrderId)) {
      throw new DomainError("VALIDATION", "purchaseOrderId must be a UUID");
    }

    const provider = getLlmProvider();
    const useLlm = !(provider instanceof NoopLlmProvider);
    const po = useLlm && purchaseOrderId ? await loadPoContext(purchaseOrderId) : null;

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await new PaddleOcrProvider(ocrUrl).extract(buffer, file.name);
    const draft = parseInvoiceText(result.text);

    let lines: ProposedInvoiceLine[] = [];
    let linesSource: "llm" | "none" = "none";
    const warnings: string[] = [];

    if (useLlm) {
      const currency = po?.currency ?? draft.currency;
      const started = Date.now();
      const text = result.text.slice(0, MAX_LLM_TEXT_CHARS);
      if (text.length < result.text.length) {
        warnings.push(`invoice text truncated to ${MAX_LLM_TEXT_CHARS} characters`);
      }
      const poLines = po?.lines ?? [];
      let failure: string | null = null;
      try {
        const llm = await provider.extractInvoiceLines({ text, poLines, currency });
        const proposed = normaliseExtractedLines(llm.lines, poLines, currency);
        lines = proposed;
        linesSource = "llm";
        warnings.push(...(llm.warnings ?? []));
        const dropped = llm.lines.length - proposed.length;
        if (dropped > 0) warnings.push(`${dropped} extracted ${dropped === 1 ? "line" : "lines"} dropped as invalid`);
        await logUsage({
          purpose: "invoice_lines",
          model: llm.usage.model,
          inputTokens: llm.usage.inputTokens,
          outputTokens: llm.usage.outputTokens,
          durationMs: Date.now() - started,
          actorUserId: actor.id,
        });
      } catch (error) {
        lines = [];
        linesSource = "none";
        if (error instanceof DomainError && error.code === "LLM_UNAVAILABLE") {
          warnings.push(`LLM unavailable: ${error.message}`);
          failure = error.message;
        } else {
          const name = error instanceof Error ? error.name : "UnknownError";
          const message = error instanceof Error ? error.message : "non-Error thrown";
          console.error("LLM line extraction failed", name, message);
          warnings.push("LLM line extraction failed");
          failure = `${name}: ${message}`;
        }
        await logUsage({
          purpose: "invoice_lines",
          model: provider.name,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: Date.now() - started,
          actorUserId: actor.id,
          error: failure,
        });
      }
    }

    return NextResponse.json({
      draft,
      lines,
      linesSource,
      ...(warnings.length ? { warnings } : {}),
      rawText: result.text.slice(0, 5000),
    });
  } catch (error) {
    return errorToResponse(error);
  }
}
