# ProcureLite — API Contract v1

Base: `/api/v1`. JSON in/out. Auth: session cookie (v1: single-tenant, simple login).
Errors: `{ "error": { "code": string, "message": string } }` with proper status codes
(400 validation, 401 unauthenticated, 403 forbidden, 404 missing, 409 conflict/state, 422 domain rule).

## Resources

### Requisitions
- `POST /requisitions` — create draft. Body: `{ supplierId, costCenterId, currency, lines: [{ description, quantity, unitPriceMinor }] }`
- `POST /requisitions/:id/submit` — draft→submitted; resolves approval chain (domain)
- `POST /approvals/:id/decide` — body: `{ decision: "approve"|"reject", comment? }` (approver only)
- `GET /requisitions` / `GET /requisitions/:id`

### Purchase Orders
- `POST /requisitions/:id/order` — submitted+fully-approved → PO. **Budget guard runs here** (422 if exceeded). Reserves budget.
- `GET /purchase-orders/:id`
- `POST /purchase-orders/:id/cancel` — releases reservation

### Receipts
- `POST /purchase-orders/:id/receipts` — body: `{ lines: [{ poLineId, quantityReceived }] }` (cumulative ≤ ordered)

### Invoices & Matching
- `POST /invoices` — body: `{ supplierId, purchaseOrderId, number, lines: [{ poLineId?, quantity, unitPriceMinor }] }`
- `POST /invoices/:id/match` — runs matching engine → `MATCHED` or exception list (422-style payload w/ exceptions, invoice stays `EXCEPTION`)
- `POST /invoices/:id/approve` — only when MATCHED (409 otherwise)

### Budgets & Analytics
- `PUT /cost-centers/:id/budget` — body: `{ yearMonth: "2026-08", amountMinor }`
- `GET /analytics/spend?groupBy=supplier|category|costCenter&from&to`

## Status machines

```
Requisition: DRAFT → SUBMITTED → APPROVED | REJECTED
PO:          OPEN → RECEIVED(partial|full) → CLOSED ; CANCELLED
Invoice:     PENDING → MATCHED | EXCEPTION → APPROVED
```

## AuthZ matrix (enforced per endpoint)

| Action | Requester | Manager | Finance | Admin |
|---|---|---|---|---|
| Create requisition | ✓ | ✓ | ✓ | ✓ |
| Approve/reject | – | ✓ (own reports) | – | ✓ |
| Receive goods | ✓ | ✓ | ✓ | ✓ |
| Invoice match/approve | – | – | ✓ | ✓ |
| Set budgets / rules | – | – | – | ✓ |
