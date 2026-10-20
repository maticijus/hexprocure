import { Money } from "./money";

export interface RawExtractedLine {
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string | null;
  poLineRef: string | null;
}

export interface ProposedInvoiceLine {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
  poLineId: string | null;
  confidence: "HIGH" | "LOW";
  warnings: string[];
}

export interface PoLineContext {
  id: string;
  description: string;
  quantityOrdered: number;
  unitPriceMinor: number;
  kind: "GOODS" | "SERVICE";
}

export const MAX_PROPOSED_LINES = 200;
const PRICE_TOLERANCE = 0.02;

export function parseAmount(raw: string): number | null {
  const s = raw.trim();
  const commaLast = /\d,\d{2}$/.test(s);
  const cleaned = commaLast ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const minor = Math.round(parseFloat(cleaned) * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function matchPoLine(
  description: string,
  quantity: number,
  unitPriceMinor: number,
  poLines: PoLineContext[],
): PoLineContext | undefined {
  const wanted = description.toLowerCase();
  return (
    poLines.find((p) => p.description.trim().toLowerCase() === wanted) ??
    poLines.find(
      (p) =>
        p.quantityOrdered === quantity &&
        Math.abs(p.unitPriceMinor - unitPriceMinor) <= p.unitPriceMinor * PRICE_TOLERANCE,
    )
  );
}

export function normaliseExtractedLines(
  raw: RawExtractedLine[],
  poLines: PoLineContext[],
  currency: string,
): ProposedInvoiceLine[] {
  const poIds = new Set(poLines.map((p) => p.id));
  const out: ProposedInvoiceLine[] = [];

  for (const line of raw) {
    if (out.length >= MAX_PROPOSED_LINES) break;
    const description = line.description.trim();
    const unitPriceMinor = parseAmount(line.unitPrice);
    if (!description || unitPriceMinor === null || !Number.isFinite(line.quantity)) continue;

    const warnings: string[] = [];
    const quantity = Math.max(1, Math.round(line.quantity));
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(quantity * unitPriceMinor)) continue;
    if (quantity !== line.quantity) warnings.push(`quantity rounded from ${line.quantity}`);

    let poLineId: string | null = null;
    let modelPicked = false;
    if (line.poLineRef !== null) {
      if (poIds.has(line.poLineRef)) {
        poLineId = line.poLineRef;
        modelPicked = true;
      } else {
        warnings.push("unknown poLineRef dropped");
      }
    }
    if (poLineId === null) {
      poLineId = matchPoLine(description, quantity, unitPriceMinor, poLines)?.id ?? null;
    }

    const computed = Money.of(quantity * unitPriceMinor, currency).amount;
    const parsedTotal = line.lineTotal === null ? null : parseAmount(line.lineTotal);
    const totalAgrees = parsedTotal !== null && Math.abs(parsedTotal - computed) <= 1;
    if (parsedTotal !== null && !totalAgrees) warnings.push("lineTotal disagrees with quantity * unitPrice");

    out.push({
      description,
      quantity,
      unitPriceMinor,
      amountMinor: parsedTotal ?? computed,
      poLineId,
      confidence: modelPicked && totalAgrees ? "HIGH" : "LOW",
      warnings,
    });
  }
  return out;
}
