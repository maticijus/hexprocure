# HexProcure: API Contract v1

Base: `/api/v1`. JSON in/out. Auth: session cookie (single-tenant, email + password login) or `Authorization: Bearer hxp_...` machine token (ADMIN-managed). A missing, invalid, revoked or expired credential returns 403, not 401.
Errors: `{ "error": { "code": string, "message": string, "details"?: object } }` with these statuses:
400 `VALIDATION`, 402 `LICENSE_REQUIRED`, 403 `FORBIDDEN` (also unauthenticated), 404 `NOT_FOUND`, 409 `INVALID_STATE` (state conflicts, also an unparseable JSON body), 422 `BUDGET_EXCEEDED`, 429 `RATE_LIMITED`, 501 `NOT_CONFIGURED`, 503 `LLM_UNAVAILABLE`, 500 `INTERNAL`.

List routes take `limit` (1 to 100, default 50) and `offset` (default 0) and answer `{ <resource>: [...], limit, offset }`, newest first. A bad filter value gives 400 `VALIDATION`, a malformed or unknown `:id` gives 400 or 404. Reads are open to any authenticated role or bearer token, like the matching UI pages.

## Resources

### Auth and sessions
- `POST /auth/register` - body `{ name, email, password }`. Creates a REQUESTER. 403 when self-registration is disabled (`ALLOW_SELF_REGISTRATION`; in production it must be `true`).
- `POST /auth/login` - body `{ email, password }`. Sets the session cookie. Rate limited per IP and per account.
- `POST /auth/logout` - revokes the session behind the current cookie (`sessions.revoked_at`) and clears the cookie. Always 200, also without a session.
- `GET /auth/tokens` - ADMIN only. Lists the caller's API tokens.
- `POST /auth/tokens` - ADMIN only. Body `{ name }`. Returns the token once (stored as a SHA-256 hash).
- `DELETE /auth/tokens/:id` - ADMIN only. Revokes the token.
- `POST /users/:id/sessions/revoke` - ADMIN only (403 otherwise; 400 on a malformed id, 404 for an unknown user). Revokes every live session of that user, writes an `audit_events` row with action `SESSIONS_REVOKED`. Response: `{ ok: true, revoked: <count> }`.

A session cookie is accepted only while its `sessions` row exists, is not revoked and has not expired; otherwise the request fails with 403.

### Requisitions
- `GET /requisitions?status&costCenterId&limit&offset` - `{ requisitions: [{ id, status, currency, createdAt, supplierId, supplier, costCenterId, costCenter, requesterId, totalMinor }], limit, offset }`.
- `GET /requisitions/:id` - header plus `lines: [{ id, description, kind, quantity, unitPriceMinor }]`, `approvals: [{ id, sequence, approverRole, decision, comment, decidedAt, decidedBy }]`, `totalMinor` and `purchaseOrderId` (null until ordered).
- `POST /requisitions` - create draft. Body: `{ supplierId, costCenterId, currency?, lines: [{ description, quantity, unitPriceMinor, kind?: "GOODS"|"SERVICE" }] }`. `currency` defaults to EUR; supported: EUR, USD, GBP, CZK, PLN, CHF. Returns 201 `{ id, status }`.
- `POST /requisitions/:id/submit` - DRAFT to SUBMITTED; resolves the approval chain (domain). 409 if not DRAFT, has no lines, or no approval rules are configured; if no rule matches the amount the call fails with 500 `INTERNAL` ("No approval rule matches this amount").
- `POST /approvals/:id/decide` - body: `{ decision: "approve"|"reject", comment? }`. Allowed for the role named on the approval step, or ADMIN (403 otherwise). 409 if already decided.

### Purchase Orders
- `GET /purchase-orders?status&supplierId&limit&offset` - `{ purchaseOrders: [{ id, status, currency, createdAt, supplierId, supplier, costCenterId, costCenter, requisitionId, totalMinor }], limit, offset }`.
- `GET /purchase-orders/:id` - header plus `lines: [{ id, description, kind, quantityOrdered, unitPriceMinor, quantityReceived, acceptanceCount, quantityInvoiced, amountInvoicedMinor }]` and `totalMinor`.
- `POST /requisitions/:id/order` - APPROVED requisition to PO (requisition becomes ORDERED). Any authenticated user. **Budget guard runs here**: 409 `INVALID_STATE` when the cost center has no budget for the month, 422 `BUDGET_EXCEEDED` when exceeded. Reserves budget. Returns 201.
- `GET /purchase-orders/:id/lines` - PO lines: `{ id, description, kind, quantityOrdered, unitPriceMinor }`.
- `GET /purchase-orders/:id/pdf?variant=supplier|internal` - deterministic PDF; supplier variant omits cost center & requester. Any other `variant` value gives the internal PDF.
- `POST /purchase-orders/:id/send` - `{ "to": "optional@override" }`; emails the supplier-variant PDF, records `PO_SENT` audit. Re-sending an OPEN PO is allowed and audited; 409 when not OPEN.
- `POST /purchase-orders/:id/cancel` - MANAGER/FINANCE/ADMIN, OPEN only (409 otherwise); releases the reservation and returns the requisition to APPROVED.

### Receipts
- `POST /purchase-orders/:id/receipts` - body: `{ lines: [{ poLineId, quantityReceived }] }` (cumulative <= ordered). Returns 201. 409 unless the PO is OPEN.
  - SERVICE lines (`kind: "SERVICE"`) are acceptance actions instead: `{ poLineId, accepted: true, quantityReceived: 0 }` (`quantityReceived` is required by validation and not used for service lines)
  - PO auto-closes when all GOODS lines are fully received AND all SERVICE lines have >=1 acceptance

### Invoices & Matching
- `GET /invoices?status&limit&offset` - `{ invoices: [{ id, number, status, currency, createdAt, supplierId, supplier, purchaseOrderId, totalMinor }], limit, offset }`. `currency` is the PO currency.
- `GET /invoices/:id` - header plus `exceptions` (the stored match exceptions), `lines: [{ id, poLineId, description, kind, quantity, unitPriceMinor, amountMinor, lineTotalMinor }]` and `totalMinor`.
- `POST /invoices` - body: `{ supplierId, purchaseOrderId, number, lines: [{ poLineId?, quantity, unitPriceMinor, amountMinor? }] }`. Returns 201 `{ id, status, number }`.
  - lines referencing SERVICE PO lines use `amountMinor` as the authoritative billed amount (quantity/price ignored for matching)
- `POST /invoices/:id/match` - runs matching engine. Returns 200 `{ status: "MATCHED"|"EXCEPTION", exceptions: [...] }`; an invoice with exceptions stays `EXCEPTION`.
  - Goods lines: `UNMATCHED_LINE`, `QUANTITY_MISMATCH` (cumulative invoiced > received), `OVER_INVOICED` (cumulative invoiced > ordered), `PRICE_MISMATCH` (outside max(2 %, 0.5 minor units)). Service lines: `OVER_INVOICED_AMOUNT`, `SERVICE_NOT_ACCEPTED`.
- `POST /invoices/:id/approve` - FINANCE/ADMIN only (403 otherwise); only when MATCHED (409 otherwise)
- `POST /invoices/extract` - multipart: `file`, optional `purchaseOrderId` (UUID). OCR draft `{ draft, lines, linesSource: "llm"|"none", warnings?, rawText }`. 501 unless `INTEGRATION_OCR_URL` is set. Line extraction runs only when `ANTHROPIC_API_KEY` is set.

### Attachments
- `POST /attachments` - multipart: `file`, `entityType` (requisition | purchase_order | invoice), `entityId`. Allowlist: pdf/png/jpeg/webp/txt/zip, <=10 MB
- `GET /attachments` - lists attachment metadata (id, entityType, entityId, filename, sizeBytes, uploadedByUserId, createdAt)
- `GET /attachments/:id` - streamed download
- `DELETE /attachments/:id` - uploader or ADMIN only

### Recurring order templates
- `POST /order-templates` - `{ name, supplierId, costCenterId, cadence: MONTHLY|QUARTERLY|YEARLY, nextRunDate?, lines: [{ description, quantity, unitPriceMinor, kind? }] }`
- `GET /order-templates`
- `POST /order-templates/run` - cron hook (ADMIN/FINANCE): generates DRAFT requisitions for due templates, advances their run date. Idempotent per day via row locks.

### Integrations
- `POST /integrations/dispatch` - ADMIN/FINANCE. Registers the connectors (CSV, email, QBO when `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` are set, webhook when `INTEGRATION_WEBHOOK_URL` is set; one connector per event type, last registered wins) and drains up to 100 pending outbox events. The timer enabled by `INTEGRATION_DISPATCH_INTERVAL_MS` delivers only after this route has run in the same process.
- `GET /integrations/qbo/connect` - ADMIN only. Redirects to Intuit OAuth. 501 unless `QBO_CLIENT_ID` and `INTEGRATION_REDIRECT_URI` are set.
- `GET /integrations/qbo/callback` - OAuth return; validates the state cookie and stores encrypted tokens. 400 on invalid state.
- `POST /integrations/qbo/disconnect` - ADMIN only.
- `GET /integrations/qbo/status` - any authenticated user. `{ connected, status, realmId, refreshExpiresAt, lastError }`.

### Analytics
- `GET /analytics/summary` - FINANCE/ADMIN. Approved-invoice totals per currency and top supplier.
- `GET /analytics/spend?groupBy=supplier|costCenter|month&from&to` - FINANCE/ADMIN. `groupBy` defaults to `supplier`.

### Meta and licence
- `GET /meta/options` - suppliers and cost centers as `{ id, name }` lists. Any authenticated user.
- `GET /meta/entities?type=requisition|purchase_order|invoice` - latest 50 `{ id, label }` entries for the attachment picker. 400 without `type`.
- `GET /license` - ADMIN only. Current licence tier and validity.

### Health
- `GET /api/health` (outside `/api/v1`, public).

Budgets and approval rules have no API route: they are configured in the database (seed script).

## Status machines

```
Requisition: DRAFT → SUBMITTED → APPROVED | REJECTED ; APPROVED → ORDERED (PO created) ; ORDERED → APPROVED (PO cancelled)
PO:          OPEN → CLOSED (fully received / accepted) ; OPEN → CANCELLED
Invoice:     PENDING → MATCHED | EXCEPTION → APPROVED (from MATCHED only; EXCEPTION invoices can be re-matched)
```

## AuthZ matrix (enforced per endpoint)

| Action | Requester | Manager | Finance | Admin |
|---|---|---|---|---|
| Read requisitions, POs, invoices (list and detail) | ✓ | ✓ | ✓ | ✓ |
| Create requisition / submit | ✓ | ✓ | ✓ | ✓ |
| Approve/reject a step | – | ✓ (steps routed to MANAGER) | ✓ (steps routed to FINANCE) | ✓ (any step) |
| Order an approved requisition | ✓ | ✓ | ✓ | ✓ |
| Send PO / download PDF | ✓ | ✓ | ✓ | ✓ |
| Cancel PO | – | ✓ | ✓ | ✓ |
| Receive goods, accept services | ✓ | ✓ | ✓ | ✓ |
| Create invoice, run match | ✓ | ✓ | ✓ | ✓ |
| Approve invoice | – | – | ✓ | ✓ |
| Analytics (summary, spend) | – | – | ✓ | ✓ |
| Dispatch outbox, run order templates | – | – | ✓ | ✓ |
| API tokens, QBO connect/disconnect, licence | – | – | – | ✓ |
| Revoke a user's sessions | – | – | – | ✓ |
| Delete attachment | own uploads | own uploads | own uploads | ✓ |
