# HexProcure — API Contract v1

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
- `GET /purchase-orders/:id/pdf?variant=supplier|internal` — deterministic PDF; supplier variant omits cost center & requester
- `POST /purchase-orders/:id/send` — `{ "to": "optional@override" }`; emails the supplier-variant PDF, records `PO_SENT` audit. Re-sending an OPEN PO is allowed and audited; 409 when not OPEN.
- `POST /purchase-orders/:id/cancel` — releases reservation

### Receipts
- `POST /purchase-orders/:id/receipts` — body: `{ lines: [{ poLineId, quantityReceived }] }` (cumulative ≤ ordered)
  - SERVICE lines (`kind: "SERVICE"`) are acceptance actions instead: `{ poLineId, accepted: true }`, no quantities
  - PO auto-closes when all GOODS lines are fully received AND all SERVICE lines have ≥1 acceptance

### Invoices & Matching
- `POST /invoices` — body: `{ supplierId, purchaseOrderId, number, lines: [{ poLineId?, quantity, unitPriceMinor, amountMinor? }] }`
  - lines referencing SERVICE PO lines use `amountMinor` as the authoritative billed amount (quantity/price ignored for matching)
- `POST /invoices/:id/match` — runs matching engine → `MATCHED` or exception list (422-style payload w/ exceptions, invoice stays `EXCEPTION`)
- `POST /invoices/:id/approve` — only when MATCHED (409 otherwise)

### Attachments
- `POST /attachments` — multipart: `file`, `entityType` (requisition | purchase_order | invoice), `entityId`. Allowlist: pdf/png/jpeg/webp/txt/zip, ≤10 MB
- `GET /attachments/:id` — streamed download
- `DELETE /attachments/:id` — uploader or ADMIN only

### Recurring order templates
- `POST /order-templates` — `{ name, supplierId, costCenterId, cadence: MONTHLY|QUARTERLY|YEARLY, nextRunDate?, lines: [{ description, quantity, unitPriceMinor, kind? }] }`
- `GET /order-templates`
- `POST /order-templates/run` — cron hook (ADMIN/FINANCE): generates DRAFT requisitions for due templates, advances their run date. Idempotent per day via row locks.

### Integrations dispatch
- `POST /integrations/dispatch` — drains outbox through registered connectors (CSV, webhook, email notifications, QBO when connected)

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
