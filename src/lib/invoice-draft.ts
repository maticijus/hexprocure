import type { ProposedInvoiceLine } from "@/domain/invoice-lines";

export interface PoLineOption {
  id: string;
  description: string;
  kind: "GOODS" | "SERVICE";
  quantityOrdered: number;
  unitPriceMinor: number;
}

export interface DraftLine {
  poLineId: string;
  description: string;
  kind: "GOODS" | "SERVICE";
  quantity: string;
  unitPrice: string;
}

export interface InvoicePayloadLine {
  poLineId: string;
  quantity: number;
  unitPriceMinor: number;
  amountMinor?: number;
}

function fractionDigits(currency: string): number {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function toMajor(minor: number, currency: string): string {
  const digits = fractionDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

function toMinor(major: string, currency: string): number {
  return Math.round(parseFloat(major) * 10 ** fractionDigits(currency));
}

export function prefillLines(poLines: PoLineOption[], currency: string): DraftLine[] {
  return poLines.map((l) =>
    l.kind === "SERVICE"
      ? { poLineId: l.id, description: l.description, kind: l.kind, quantity: "1", unitPrice: toMajor(l.quantityOrdered * l.unitPriceMinor, currency) }
      : { poLineId: l.id, description: l.description, kind: l.kind, quantity: String(l.quantityOrdered), unitPrice: toMajor(l.unitPriceMinor, currency) },
  );
}

function matchedIds(proposed: ProposedInvoiceLine[]): Set<string> {
  return new Set(proposed.flatMap((p) => (p.poLineId ? [p.poLineId] : [])));
}

export function applyExtracted(lines: DraftLine[], proposed: ProposedInvoiceLine[], currency: string): DraftLine[] {
  const byPoLine = new Map(proposed.filter((p) => p.poLineId).map((p) => [p.poLineId, p]));
  return lines.map((line) => {
    const hit = byPoLine.get(line.poLineId);
    if (!hit) return { ...line, quantity: "0" };
    return line.kind === "SERVICE"
      ? { ...line, quantity: "1", unitPrice: toMajor(hit.amountMinor, currency) }
      : { ...line, quantity: String(hit.quantity), unitPrice: toMajor(hit.unitPriceMinor, currency) };
  });
}

export function unmatchedNote(lines: DraftLine[], proposed: ProposedInvoiceLine[]): string | null {
  const matched = matchedIds(proposed);
  const count = lines.filter((l) => !matched.has(l.poLineId)).length;
  return count === 0 ? null : `${count} ${count === 1 ? "line" : "lines"} not found on the invoice, quantity set to 0`;
}

export function toInvoicePayload(lines: DraftLine[], currency: string): InvoicePayloadLine[] {
  return lines
    .filter((l) => Number(l.quantity) > 0)
    .map((l) => {
      const unitPriceMinor = toMinor(l.unitPrice, currency);
      const quantity = Number(l.quantity);
      return l.kind === "SERVICE"
        ? { poLineId: l.poLineId, quantity, unitPriceMinor, amountMinor: unitPriceMinor }
        : { poLineId: l.poLineId, quantity, unitPriceMinor };
    });
}
