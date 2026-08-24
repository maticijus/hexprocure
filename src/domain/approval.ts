import { Money } from "./money";

export type ApproverRole = "MANAGER" | "FINANCE" | "ADMIN" | (string & {});

export interface ApprovalRule {
  id: string;
  /** Lower bound of applicability, inclusive. */
  minAmount: Money;
  /** Upper bound, inclusive. Omit for an open-ended escalation step. */
  maxAmount?: Money;
  approverRole: ApproverRole;
}

export interface ApprovalStep {
  ruleId: string;
  approverRole: ApproverRole;
}

interface CompiledRule {
  id: string;
  role: ApproverRole;
  min: number;
  max: number | undefined;
}

function compile(rules: ApprovalRule[]): CompiledRule[] {
  return rules.map((r) => {
    const min = r.minAmount.amount;
    const max = r.maxAmount ? r.maxAmount.amount : undefined;
    if (max !== undefined && max <= min) {
      throw new Error(
        `Approval rule ${r.id}: max must be greater than min`,
      );
    }
    return { id: r.id, role: r.approverRole, min, max };
  });
}

function assertNoBoundedOverlap(rules: CompiledRule[]): void {
  const bounded = rules.filter((r) => r.max !== undefined);
  for (let i = 0; i < bounded.length; i++) {
    for (let j = i + 1; j < bounded.length; j++) {
      const a = bounded[i];
      const b = bounded[j];
      if (a.min < b.max! && b.min < a.max!) {
        throw new Error(`Approval rules ${a.id} and ${b.id} overlap`);
      }
    }
  }
}

export function resolveApprovalChain(
  amount: Money,
  rules: ApprovalRule[],
): ApprovalStep[] {
  if (rules.length === 0) {
    throw new Error("No approval rules configured");
  }
  const currency = rules[0].minAmount.currency;
  for (const r of rules) {
    if (r.minAmount.currency !== currency ||
        (r.maxAmount && r.maxAmount.currency !== currency)) {
      throw new Error("All approval rules must share one currency");
    }
  }
  if (amount.currency !== currency) {
    throw new Error(
      `Currency mismatch: requisition ${amount.currency} vs rules ${currency}`,
    );
  }

  const compiled = compile(rules);
  assertNoBoundedOverlap(compiled);

  const bandRule = compiled
    .filter(
      (r) => r.max !== undefined && amount.amount >= r.min && amount.amount <= r.max,
    )
    .sort((a, b) => b.min - a.min)[0];
  const escalations = compiled
    .filter((r) => r.max === undefined && amount.amount >= r.min)
    .sort((a, b) => a.min - b.min);

  if (!bandRule && escalations.length === 0) {
    throw new Error("No approval rule matches this amount");
  }

  const steps: ApprovalStep[] = [];
  if (bandRule) {
    steps.push({ ruleId: bandRule.id, approverRole: bandRule.role });
  }
  for (const e of escalations) {
    steps.push({ ruleId: e.id, approverRole: e.role });
  }
  return steps;
}
