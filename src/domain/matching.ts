export interface PoLine {
  id: string;
  quantityOrdered: number;
  unitPriceMinor: number;
}

export interface InvoiceLine {
  poLineId: string | null;
  quantity: number;
  unitPriceMinor: number;
}

export interface MatchContext {
  poLines: PoLine[];
  receivedQtyByPoLine: Record<string, number>;
  previouslyInvoicedQtyByPoLine: Record<string, number>;
}

export type MatchExceptionType =
  | "UNMATCHED_LINE"
  | "QUANTITY_MISMATCH"
  | "OVER_INVOICED"
  | "PRICE_MISMATCH";

export interface MatchException {
  type: MatchExceptionType;
  invoiceLineIndex: number;
  poLineId?: string;
  detail: string;
}

export type MatchResult =
  | { status: "MATCHED"; exceptions: [] }
  | { status: "EXCEPTION"; exceptions: MatchException[] };

const PRICE_TOLERANCE_RATIO = 0.02;
const PRICE_TOLERANCE_FLOOR = 0.5;

function priceWithinTolerance(poPrice: number, invoicePrice: number): boolean {
  const tolerance = Math.max(
    poPrice * PRICE_TOLERANCE_RATIO,
    PRICE_TOLERANCE_FLOOR,
  );
  return Math.abs(invoicePrice - poPrice) <= tolerance;
}

export function matchInvoice(
  ctx: MatchContext,
  invoiceLines: InvoiceLine[],
): MatchResult {
  if (invoiceLines.length === 0) {
    throw new Error("Invoice has no lines");
  }
  invoiceLines.forEach((line, i) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`Invoice line ${i}: quantity must be a positive integer`);
    }
  });

  const poById = new Map(ctx.poLines.map((p) => [p.id, p]));
  const exceptions: MatchException[] = [];

  invoiceLines.forEach((line, i) => {
    const poLine = line.poLineId ? poById.get(line.poLineId) : undefined;
    if (!poLine) {
      exceptions.push({
        type: "UNMATCHED_LINE",
        invoiceLineIndex: i,
        detail: line.poLineId
          ? `Unknown PO line ${line.poLineId}`
          : "Invoice line has no PO reference",
      });
      return;
    }

    const received = ctx.receivedQtyByPoLine[poLine.id] ?? 0;
    if (line.quantity > received) {
      exceptions.push({
        type: "QUANTITY_MISMATCH",
        invoiceLineIndex: i,
        poLineId: poLine.id,
        detail: `Invoiced ${line.quantity}, received ${received}`,
      });
    }

    const prior = ctx.previouslyInvoicedQtyByPoLine[poLine.id] ?? 0;
    if (prior + line.quantity > poLine.quantityOrdered) {
      exceptions.push({
        type: "OVER_INVOICED",
        invoiceLineIndex: i,
        poLineId: poLine.id,
        detail: `Cumulative invoiced ${prior + line.quantity} exceeds ordered ${poLine.quantityOrdered}`,
      });
    }

    if (!priceWithinTolerance(poLine.unitPriceMinor, line.unitPriceMinor)) {
      exceptions.push({
        type: "PRICE_MISMATCH",
        invoiceLineIndex: i,
        poLineId: poLine.id,
        detail: `Invoiced ${line.unitPriceMinor} vs PO ${poLine.unitPriceMinor}`,
      });
    }
  });

  return exceptions.length === 0
    ? { status: "MATCHED", exceptions: [] }
    : { status: "EXCEPTION", exceptions };
}
