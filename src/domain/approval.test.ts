import { describe, it, expect } from "vitest";
import { Money } from "./money";
import { resolveApprovalChain, type ApprovalRule } from "./approval";

const eur = (v: number) => Money.of(v, "EUR");

const rules: ApprovalRule[] = [
  { id: "r1", minAmount: eur(0), maxAmount: eur(500), approverRole: "MANAGER" },
  { id: "r2", minAmount: eur(500), maxAmount: eur(5000), approverRole: "MANAGER" },
  { id: "r3", minAmount: eur(5000), approverRole: "ADMIN" },
];

describe("resolveApprovalChain", () => {
  it("routes small amounts to the first matching rule's role", () => {
    const chain = resolveApprovalChain(eur(100), rules);
    expect(chain.map((s) => s.approverRole)).toEqual(["MANAGER"]);
  });

  it("selects exactly one step for a mid-range amount", () => {
    const chain = resolveApprovalChain(eur(2500), rules);
    expect(chain).toHaveLength(1);
  });

  it("escalates large amounts to ADMIN via the open-ended rule", () => {
    const chain = resolveApprovalChain(eur(9000), rules);
    expect(chain.map((s) => s.approverRole)).toEqual(["ADMIN"]);
  });

  it("treats boundary amount as belonging to the rule whose range includes it", () => {
    const chain = resolveApprovalChain(eur(500), rules);
    expect(chain[0].ruleId).toBe("r2");
  });

  it("throws when no rule matches", () => {
    const noRules: ApprovalRule[] = [
      { id: "r1", minAmount: eur(1000), approverRole: "MANAGER" },
    ];
    expect(() => resolveApprovalChain(eur(50), noRules)).toThrow(
      /no approval rule/i,
    );
  });

  it("rejects an empty rule set", () => {
    expect(() => resolveApprovalChain(eur(10), [])).toThrow(/no approval rule/i);
  });

  it("rejects overlapping rule ranges at definition time", () => {
    const overlapping: ApprovalRule[] = [
      { id: "a", minAmount: eur(0), maxAmount: eur(1000), approverRole: "MANAGER" },
      { id: "b", minAmount: eur(500), maxAmount: eur(2000), approverRole: "ADMIN" },
    ];
    expect(() => resolveApprovalChain(eur(10), overlapping)).toThrow(
      /overlap/,
    );
  });

  it("rejects a rule whose max is not above its min", () => {
    const bad: ApprovalRule[] = [
      { id: "bad", minAmount: eur(100), maxAmount: eur(100), approverRole: "X" },
    ];
    expect(() => resolveApprovalChain(eur(150), bad)).toThrow(/max.*min|range/);
  });
});

describe("multi-step chains", () => {
  it("supports sequential rules producing ordered steps", () => {
    const twoStep: ApprovalRule[] = [
      { id: "mgr", minAmount: eur(0), approverRole: "MANAGER" },
      { id: "fin", minAmount: eur(2000), approverRole: "FINANCE" },
    ];
    const chain = resolveApprovalChain(eur(3000), twoStep);
    expect(chain.map((s) => s.approverRole)).toEqual(["MANAGER", "FINANCE"]);
  });

  it("skips higher steps below their threshold", () => {
    const twoStep: ApprovalRule[] = [
      { id: "mgr", minAmount: eur(0), approverRole: "MANAGER" },
      { id: "fin", minAmount: eur(2000), approverRole: "FINANCE" },
    ];
    const chain = resolveApprovalChain(eur(1999), twoStep);
    expect(chain.map((s) => s.approverRole)).toEqual(["MANAGER"]);
  });

  it("rejects mixed-currency rules vs requisition", () => {
    const usdRules: ApprovalRule[] = [
      { id: "u", minAmount: Money.of(0, "USD"), approverRole: "MANAGER" },
    ];
    expect(() => resolveApprovalChain(eur(100), usdRules)).toThrow(
      /currency mismatch/i,
    );
  });
});
