export type PoLineKind = "GOODS" | "SERVICE";

export interface PoLine {
  id: string;
  quantityOrdered: number;
  unitPriceMinor: number;
  kind?: PoLineKind;
}

export interface InvoiceLine {
  poLineId: string | null;
  quantity: number;
  unitPriceMinor: number;
  /** Authoritative billed amount for SERVICE lines. */
  amountMinor?: number;
}

export interface MatchContext {
  poLines: PoLine[];
  receivedQtyByPoLine: Record<string, number>;
  previouslyInvoicedQtyByPoLine: Record<string, number>;
  /** Cumulative prior invoiced amounts for SERVICE lines. */
  previouslyInvoicedAmountByPoLine?: Record<string, number>;
}

export type MatchExceptionType =
  | "UNMATCHED_LINE"
  | "QUANTITY_MISMATCH"
  | "OVER_INVOICED"
  | "OVER_INVOICED_AMOUNT"
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

type Running = Map<string, number>;

function addRunning(running: Running, poLineId: string, value: number): number {
  const total = (running.get(poLineId) ?? 0) + value;
  running.set(poLineId, total);
  return total;
}

function checkServiceLine(
  ctx: MatchContext,
  poLine: PoLine,
  line: InvoiceLine,
  i: number,
  runningAmount: Running,
): MatchException[] {
  const orderedAmount = poLine.quantityOrdered * poLine.unitPriceMinor;
  const priorAmount = ctx.previouslyInvoicedAmountByPoLine?.[poLine.id] ?? 0;
  const thisAmount = line.amountMinor ?? line.quantity * line.unitPriceMinor;
  const cumulative =
    priorAmount + addRunning(runningAmount, poLine.id, thisAmount);
  if (cumulative <= orderedAmount) return [];
  return [
    {
      type: "OVER_INVOICED_AMOUNT",
      invoiceLineIndex: i,
      poLineId: poLine.id,
      detail: `Cumulative invoiced ${cumulative} exceeds ordered ${orderedAmount}`,
    },
  ];
}

function checkGoodsLine(
  ctx: MatchContext,
  poLine: PoLine,
  line: InvoiceLine,
  i: number,
  runningQty: Running,
): MatchException[] {
  const exceptions: MatchException[] = [];
  const received = ctx.receivedQtyByPoLine[poLine.id] ?? 0;
  const prior = ctx.previouslyInvoicedQtyByPoLine[poLine.id] ?? 0;
  const cumulative = prior + addRunning(runningQty, poLine.id, line.quantity);
  const base = { invoiceLineIndex: i, poLineId: poLine.id };
  if (cumulative > received) {
    exceptions.push({
      ...base,
      type: "QUANTITY_MISMATCH",
      detail: `Cumulative invoiced ${cumulative}, received ${received}`,
    });
  }
  if (cumulative > poLine.quantityOrdered) {
    exceptions.push({
      ...base,
      type: "OVER_INVOICED",
      detail: `Cumulative invoiced ${cumulative} exceeds ordered ${poLine.quantityOrdered}`,
    });
  }
  if (!priceWithinTolerance(poLine.unitPriceMinor, line.unitPriceMinor)) {
    exceptions.push({
      ...base,
      type: "PRICE_MISMATCH",
      detail: `Invoiced ${line.unitPriceMinor} vs PO ${poLine.unitPriceMinor}`,
    });
  }
  return exceptions;
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
  const runningQty: Running = new Map();
  const runningAmount: Running = new Map();
  const exceptions = invoiceLines.flatMap((line, i): MatchException[] => {
    const poLine = line.poLineId ? poById.get(line.poLineId) : undefined;
    if (!poLine) {
      return [
        {
          type: "UNMATCHED_LINE",
          invoiceLineIndex: i,
          detail: line.poLineId
            ? `Unknown PO line ${line.poLineId}`
            : "Invoice line has no PO reference",
        },
      ];
    }
    // Services are amount-only: no quantity or price checks.
    return poLine.kind === "SERVICE"
      ? checkServiceLine(ctx, poLine, line, i, runningAmount)
      : checkGoodsLine(ctx, poLine, line, i, runningQty);
  });

  return exceptions.length === 0
    ? { status: "MATCHED", exceptions: [] }
    : { status: "EXCEPTION", exceptions };
}
