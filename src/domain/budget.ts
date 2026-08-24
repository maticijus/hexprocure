import { Money } from "./money";

export type YearMonth = string;

export interface BudgetEntry {
  budgetedMinor: number;
  currency: string;
  reservations: Map<string, number>;
}

export interface BudgetState {
  entries: Map<string, BudgetEntry>;
}

const key = (costCenterId: string, month: YearMonth) => `${costCenterId}::${month}`;

export function emptyBudgetState(): BudgetState {
  return { entries: new Map() };
}

export function setBudget(
  state: BudgetState,
  costCenterId: string,
  month: YearMonth,
  amount: Money,
): BudgetState {
  if (amount.amount < 0) {
    throw new Error("Budget cannot be negative");
  }
  const entries = new Map(state.entries);
  const existing = entries.get(key(costCenterId, month));
  if (existing && existing.currency !== amount.currency) {
    throw new Error("Currency mismatch: budget currency cannot change mid-period");
  }
  entries.set(key(costCenterId, month), {
    budgetedMinor: amount.amount,
    currency: amount.currency,
    reservations: existing?.reservations ?? new Map(),
  });
  return { entries };
}

function requireEntry(
  state: BudgetState,
  costCenterId: string,
  month: YearMonth,
): BudgetEntry {
  const entry = state.entries.get(key(costCenterId, month));
  if (!entry) {
    throw new Error(`No budget set for ${costCenterId} in ${month}`);
  }
  return entry;
}

const reservedMinorFor = (entry: BudgetEntry) =>
  [...entry.reservations.values()].reduce((a, b) => a + b, 0);

export function availableFor(
  state: BudgetState,
  costCenterId: string,
  month: YearMonth,
): Money {
  const entry = state.entries.get(key(costCenterId, month));
  if (!entry) return Money.of(0, "EUR");
  return Money.of(
    entry.budgetedMinor - reservedMinorFor(entry),
    entry.currency,
  );
}

export type GuardResult =
  | { status: "ok" }
  | { status: "exceeded"; availableMinor: number };

export function guard(
  state: BudgetState,
  costCenterId: string,
  month: YearMonth,
  amount: Money,
): GuardResult {
  const available = availableFor(state, costCenterId, month);
  if (amount.isLessThanOrEqual(available)) return { status: "ok" };
  return { status: "exceeded", availableMinor: available.amount };
}

export function reserve(
  state: BudgetState,
  costCenterId: string,
  month: YearMonth,
  amount: Money,
  reservationId: string,
): BudgetState {
  requireEntry(state, costCenterId, month);
  const result = guard(state, costCenterId, month, amount);
  if (result.status === "exceeded") {
    throw new Error(
      `Insufficient budget: requested ${amount.amount}, available ${result.availableMinor}`,
    );
  }
  const entry = requireEntry(state, costCenterId, month);
  const entries = new Map(state.entries);
  entries.set(key(costCenterId, month), {
    ...entry,
    reservations: new Map(entry.reservations).set(reservationId, amount.amount),
  });
  return { entries };
}

export function releaseReservation(
  state: BudgetState,
  reservationId: string,
): BudgetState {
  const entries = new Map(state.entries);
  for (const [k, entry] of entries) {
    if (entry.reservations.has(reservationId)) {
      const reservations = new Map(entry.reservations);
      reservations.delete(reservationId);
      entries.set(k, { ...entry, reservations });
      return { entries };
    }
  }
  throw new Error(`Unknown reservation: ${reservationId}`);
}
