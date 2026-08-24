# ProcureLite — Architecture

SMB procure-to-pay: Requisition → Approval → PO → Receipt → Invoice match, with budget control and spend analytics.

## Layering

```
src/
  domain/        Pure business logic. No I/O, no framework imports. Fully unit-tested.
    money.ts         Minor-unit integer money + currency-aware arithmetic
    approval.ts      Approval chain resolution & routing
    matching.ts      2/3-way invoice matching
    budget.ts        Budget check / reservation
  lib/           Adapters (db client, repos). Thin, integration-tested.
  app/           Next.js routes & API handlers. Validation only; delegates to domain.
```

**Dependency rule:** `app → lib → domain`. Domain never imports upward.

## Core model

- **Money**: integers in minor units (cents). Never floats.
- **ApprovalRule**: `{ minAmount, maxAmount?, approverRole }` — ordered rules per org;
  a requisition routes to the first matching rule's approver role. Amounts above all
  rule ceilings escalate to `ADMIN`.
- **Budget**: monthly budget per cost center. Guard returns `ok | exceeded(available)`.
  PO creation reserves; cancellation releases.
- **Matching**: invoice lines vs PO lines vs receipts.
  - tolerance: qty ±0%, price ±2% or ±0.50 minor units/unit, whichever greater
  - status: `MATCHED` | `QUANTITY_MISMATCH` | `PRICE_MISMATCH` | `UNMATCHED_LINE` | `OVER_INVOICED`

## Invariants (enforced by domain, tested first)

1. Money never negative unless explicitly allowed (credit notes).
2. A requisition cannot exceed remaining budget at PO time.
3. An invoice cannot be approved while status ≠ MATCHED (exceptions route to reviewer).
4. Total invoiced against a PO line can never exceed ordered quantity (over-invoicing).
5. Every state change appends an audit event.

## Testing strategy

- Unit (Vitest): domain — RED→GREEN→REFACTOR per behavior, ≥80% coverage gate.
- Integration: API routes against real Postgres (local dev instance).
- E2E (Playwright): later milestone — request→PO→match happy path.
