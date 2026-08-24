import { describe, it, expect } from "vitest";
import { Money } from "./money";
import {
  emptyBudgetState,
  setBudget,
  availableFor,
  guard,
  reserve,
  releaseReservation,
} from "./budget";

const eur = (v: number) => Money.of(v, "EUR");
const CC = "cc-1";
const MONTH = "2026-08";

describe("budget state", () => {
  it("starts with zero availability", () => {
    const s = emptyBudgetState();
    expect(availableFor(s, CC, MONTH).amount).toBe(0);
  });

  it("setBudget defines available amount", () => {
    let s = emptyBudgetState();
    s = setBudget(s, CC, MONTH, eur(10000));
    expect(availableFor(s, CC, MONTH)).toEqual(eur(10000));
  });

  it("budgets are isolated per cost center and month", () => {
    let s = emptyBudgetState();
    s = setBudget(s, CC, MONTH, eur(10000));
    expect(availableFor(s, "cc-2", MONTH).amount).toBe(0);
    expect(availableFor(s, CC, "2026-09").amount).toBe(0);
  });

  it("rejects negative budgets", () => {
    expect(() => setBudget(emptyBudgetState(), CC, MONTH, eur(-1))).toThrow(
      /negative/,
    );
  });
});

describe("guard (pre-order check)", () => {
  it("passes when amount fits in remaining budget", () => {
    let s = emptyBudgetState();
    s = setBudget(s, CC, MONTH, eur(10000));
    const result = guard(s, CC, MONTH, eur(6000));
    expect(result.status).toBe("ok");
  });

  it("fails when amount exceeds remaining budget, reporting availability", () => {
    let s = emptyBudgetState();
    s = setBudget(s, CC, MONTH, eur(1000));
    const result = guard(s, CC, MONTH, eur(1001));
    expect(result).toMatchObject({ status: "exceeded", availableMinor: 1000 });
  });

  it("exact remaining amount passes (boundary)", () => {
    let s = emptyBudgetState();
    s = setBudget(s, CC, MONTH, eur(1000));
    expect(guard(s, CC, MONTH, eur(1000)).status).toBe("ok");
  });
});

describe("reservations", () => {
  it("reserved amounts reduce availability", () => {
    let s = emptyBudgetState();
    s = setBudget(s, CC, MONTH, eur(10000));
    s = reserve(s, CC, MONTH, eur(4000), "po-1");
    expect(availableFor(s, CC, MONTH).amount).toBe(6000);
  });

  it("cannot reserve more than available", () => {
    let s = emptyBudgetState();
    s = setBudget(s, CC, MONTH, eur(1000));
    expect(() => reserve(s, CC, MONTH, eur(2000), "po-1")).toThrow(
      /insufficient/i,
    );
  });

  it("releasing a reservation restores availability", () => {
    let s = emptyBudgetState();
    s = setBudget(s, CC, MONTH, eur(5000));
    s = reserve(s, CC, MONTH, eur(3000), "po-1");
    s = releaseReservation(s, "po-1");
    expect(availableFor(s, CC, MONTH).amount).toBe(5000);
  });

  it("releasing an unknown reservation throws", () => {
    expect(() => releaseReservation(emptyBudgetState(), "ghost")).toThrow(
      /unknown reservation/i,
    );
  });

  it("reservation on unbudgeted cost center fails", () => {
    expect(() =>
      reserve(emptyBudgetState(), "nope", MONTH, eur(10), "po-1"),
    ).toThrow(/no budget/i);
  });
});
