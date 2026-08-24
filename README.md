# HexProcure

Lightweight, open procure-to-pay for SMBs: requisitions → rule-based approvals → purchase orders → goods receipt → invoice matching — with budget control, ERP/AP integrations, and AI-assisted invoice intake.

**Status:** MVP / not production-hardened. See [Known gaps](#known-gaps) before deploying.

## Why

Small teams manage purchasing over email and spreadsheets: no approval control, no PO trail, invoice mismatches discovered at month-end. Enterprise suites cost thousands per month and take weeks to implement. HexProcure covers the essential procure-to-pay loop with transparent, self-hosted simplicity.

## Functionality

### Procure-to-pay workflow

The core loop walks a purchase through five states, each enforced by domain logic:

1. **Requisition** — any user creates a request with line items (description, quantity, unit price) against a supplier and cost center.
2. **Approval** — submitting resolves an approval chain from configured amount-band rules (see below) and creates one approval task per step. Approvers see only tasks matching their role; admins can act on any step.
3. **Purchase order** — once every step approves, ordering generates a PO with lines mirrored from the requisition. This is where the budget guard runs.
4. **Goods receipt** — receipts are recorded per PO line; cumulative received quantity can never exceed ordered quantity. A fully-received PO closes automatically.
5. **Invoice matching** — invoices are matched 2/3-way against PO and receipts (details below). Only `MATCHED` invoices can be approved by finance.

Every state change appends an immutable audit event (`who`, `what`, `when`, payload).

### Approval engine

Rules are ordered amount bands, e.g.:

| Rule | Range | Approver |
|---|---|---|
| 1 | €0 – €500 | MANAGER |
| 2 | €500 – €5,000 | MANAGER |
| 3 | ≥ €5,000 (open-ended) | FINANCE |

- A requisition's total lands in exactly **one band**; boundary amounts belong to the higher band.
- Open-ended rules act as **escalation steps**: a €9,000 request is approved by FINANCE alone, while a €6,000 request under rules "manager up to ∞" + "finance above €2k" requires both, in sequence.
- Overlapping bands are rejected at configuration time; currency mixing between rules is rejected too.

### Budget control

Monthly budgets per cost center. Creating a PO **reserves** its total atomically (`SELECT … FOR UPDATE` serializes concurrent orders, so two buyers can never double-spend the same budget). Cancelling a PO releases its reservation. Ordering without sufficient budget fails with a distinct `BUDGET_EXCEEDED` error carrying the available amount.

### Invoice matching

Each invoice line is checked against three dimensions:

| Check | Rule |
|---|---|
| `UNMATCHED_LINE` | line has no PO reference or points at an unknown PO line |
| `QUANTITY_MISMATCH` | invoiced quantity exceeds received quantity for that PO line |
| `OVER_INVOICED` | cumulative invoiced quantity (this + prior invoices on the same PO) exceeds ordered quantity |
| `PRICE_MISMATCH` | unit price deviates more than max(2%, €0.005 floor) from the PO price |

Clean invoices become `MATCHED`; anything else lands in `EXCEPTION` with a structured exception list for review. Approved invoices emit integration events (below).

### Money handling

All amounts are **integers in minor units** (cents) wrapped in a currency-aware `Money` value object. Arithmetic refuses mixed currencies, negative results (unless explicitly allowed), and fractional minor units. No floats touch a balance anywhere.

### Integrations (ERP/AP connectivity)

Domain events (`PO_CREATED`, `PO_CANCELLED`, `INVOICE_APPROVED`) are written to a **transactional outbox** in the same database transaction as the business change — events cannot be lost even if delivery fails. A dispatch loop drains pending events through registered connectors:

| Connector | Target | Delivery semantics |
|---|---|---|
| **CSV flat-file** | Any ERP/AP with a file import | Wide-format rows (header + line records), RFC-4180 escaping, stable column order |
| **Generic webhook** | Zapier/Make/custom HTTP endpoints | Signed POSTs (`X-HexProcure-Signature`, HMAC-SHA256), 4xx = non-retryable, 5xx/429/network = retryable |
| **Email notifications** | Approvers, requesters, finance | Approval requests, decisions, and invoice exceptions via SMTP (`SMTP_URL`); log-only mode when unset |
| **QuickBooks Online mappers** | QBO `PurchaseOrder` / `Bill` payloads | Minor-unit→decimal conversion at the boundary only |

Failed deliveries stay `PENDING` with attempt counts and last error, retried on next dispatch. Dispatch is triggered via `POST /api/v1/integrations/dispatch` (FINANCE/ADMIN).

## AI functionality

HexProcure includes an **AI-assisted invoice intake pipeline** that turns unstructured invoice documents into reviewable drafts:

```
invoice.pdf ──▶ POST /api/v1/invoices/extract
                  │
                  ├─▶ OCR sidecar (PaddleOCR, self-hosted Python service)
                  │     • renders PDF pages / reads images
                  │     • returns raw text + per-line confidence
                  ▼
               Text parser (deterministic, rule-based)
                  • invoice number   (labeled patterns: "Invoice", "Rechnung", …)
                  • issue date       (ISO and DD.MM.YYYY formats)
                  • grand total      (labeled-total preference, EU decimal-comma aware,
                                      converted to integer minor units)
                  • VAT ID           (EU-style country-prefixed pattern)
                  • confidence flag  (HIGH = key fields found; LOW = human must fill blanks)
                  ▼
               Draft response → human reviews/edits → invoice created
                  → existing 2/3-way matching takes over
```

Design decisions worth knowing:

- **Self-hosted OCR.** The sidecar wraps [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR); documents never leave your infrastructure. It runs as an isolated FastAPI service (`services/ocr/`, Dockerfile included) so the heavy ML dependencies stay out of the main app. Enable by setting `INTEGRATION_OCR_URL=http://localhost:8100`.
- **Human-in-the-loop by design.** Extraction produces a *draft*, never an auto-created invoice. Low-confidence fields are surfaced as `null` rather than guessed.
- **Deterministic structuring.** Field extraction from OCR text uses tested regex rules, not an LLM — same input, same output, no per-invoice API cost, no data sent to third parties. (An optional LLM connector slot exists in the integration layer if you later want LLM-based line-item extraction.)

## Auth

Email + password registration and login. Passwords are hashed with scrypt (unique per-user salt). Sessions are HMAC-SHA256–signed tokens stored in `HttpOnly` / `SameSite=Lax` cookies with 7-day expiry; signature and expiry checks use timing-safe comparison. Role-based authorization (REQUESTER / MANAGER / FINANCE / ADMIN) is enforced per endpoint and in the UI.

## UI

Coupa-inspired enterprise layout: sidebar navigation, dashboard KPI cards (open requisitions, monthly budget, reserved spend, invoice exceptions), budget utilization bar, approval inbox with inline approve/reject, and list views with color-coded status pills throughout.

## Stack

Next.js 16 (App Router) · TypeScript · PostgreSQL · Drizzle ORM · Tailwind CSS 4 · Vitest · FastAPI sidecar for OCR

## Quick start

Prereqs: Node 22+, a local PostgreSQL. (Optional, for AI intake: Docker or Python 3.11 for the OCR sidecar.)

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL / AUTH_SECRET
npx drizzle-kit migrate         # apply schema to your database
npx tsx scripts/seed.ts         # demo users + data
npm run dev                     # http://localhost:3000/login
```

Demo logins (password `password123`): `rita@hexprocure.dev` (requester), `max@…` (manager), `fiona@…` (finance), `admin@…` (admin).

### Enabling AI invoice intake (optional)

```bash
cd services/ocr
docker build -t hexprocure-ocr . && docker run -p 8100:8100 hexprocure-ocr
# then add INTEGRATION_OCR_URL=http://localhost:8100 to .env and restart
```

First start downloads the PaddleOCR models (~hundreds of MB). Test:

```bash
curl -F "file=@invoice.pdf" \
  -H "Cookie: <your session cookie>" \
  http://localhost:3000/api/v1/invoices/extract
```

## Scripts

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint
npx tsc --noEmit     # typecheck
npx vitest run             # all tests
npx vitest run --coverage  # with coverage gate on business logic
npx drizzle-kit migrate    # apply schema migrations
```

Tests use their own database via `.env.test` so they never touch dev data.

## Architecture

```
src/
  domain/       Pure business logic (money, approvals, budgets, matching). No I/O.
  lib/
    services/   Transactional flows wiring domain ↔ Postgres
    api/        Auth + error mapping for route handlers
    integrations/ Outbox dispatch, connectors (CSV, webhook, QBO),
                  OCR provider + invoice text parser
    db/         Drizzle schema + client
  app/          Next.js routes & API handlers (thin adapters)
services/
  ocr/          Self-hosted PaddleOCR sidecar (Python/FastAPI)
```

Dependency rule: `app → lib → domain`; the domain layer is pure and fully unit-tested (coverage gate ≥80% on business logic). API contract and product brief live in [`docs/`](docs/).

## Known gaps

- No CSRF tokens beyond `SameSite=Lax` cookies; no rate limiting
- Session revocation (stateless tokens until a session store lands)
- QBO connector ships payload mappers only — OAuth client not implemented
- Integration dispatch is pull-based (`POST /api/v1/integrations/dispatch`) — needs a scheduler in production
- Single-currency display (EUR); money stored currency-aware but UI assumes EUR
- Invoice line items are entered manually after extraction; automatic line-item extraction from OCR text is future work
- PO PDF download and email-to-supplier are API-only (`GET …/pdf`, `POST …/send`); UI buttons are future work

## License

MIT — see [LICENSE](LICENSE).
