# Changelog

All notable changes to HexProcure are documented here, grouped loosely per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-08-25

First public release of the procure-to-pay core: requisition → rule-based
approval → purchase order → goods/service receipt → 2/3-way invoice matching,
with budget control, ERP/AP integrations, AI-assisted invoice intake and a full
management UI.

### Added

- **P2P core** — requisitions with line items; approval chains resolved from
  amount-band rules (half-open bands, highest-band precedence); PO generation
  guarded by row-locked budget reservation; cumulative goods receipt with
  auto-close; invoice matching (quantity / price-tolerance / over-invoice,
  amount-based variant for SERVICE lines); immutable audit trail on every state
  change
- **Auth & roles** — scrypt password hashes, HMAC-signed HttpOnly session
  cookies, REQUESTER/MANAGER/FINANCE/ADMIN matrix enforced in endpoints and UI
- **Machine API tokens** — `hxp_…` Bearer tokens (sha256 hash-at-rest, shown
  once, revocable) for unattended cron dispatch and recurring-template runs
- **Integrations outbox** — transactional event table drained through CSV
  export, HMAC-signed webhook, SMTP email notifications (log-only fallback),
  and QuickBooks Online payload mappers + rotating refresh-token connection
  store (live OAuth specced, needs Intuit sandbox credentials)
- **AI invoice intake** — PaddleOCR FastAPI sidecar (`services/ocr`), multipart
  `/invoices/extract` endpoint, labeled-total/EU-date text parser to draft
- **PO documents** — deterministic server-side PDF generation and audited
  send-to-supplier email
- **Attachments** — polymorphic upload/download/delete for requisitions, POs
  and invoices with MIME allowlist + 10 MB cap, local file store
- **SERVICE procurement** — GOODS/SERVICE line kinds flowing requisition → PO →
  matching, service acceptance receipts
- **Recurring orders** — MONTHLY/QUARTERLY/YEARLY templates with month-end
  clamping, locked due-generation endpoint for cron
- **Spend analytics** — supplier/cost-center/category/month aggregations plus
  KPI summary (FINANCE/ADMIN)
- **UI** — Coupa-inspired shell: dashboard KPIs, approval inbox with inline
  decisions, requisition form with kind picker, list pages with status pills
  and row actions (submit, PDF download, email supplier, accept services),
  attachments manager, recurring template manager, QBO status card, analytics
  page with zero-dependency CSS charts
- **Security hardening** — origin-check CSRF middleware (Bearer exempt),
  sliding-window rate limiting (auth 10/min · mutations 60/min · reads 300/min,
  env-overridable, memory-bounded), AES-256-GCM token envelope crypto with key
  rotation
- **Quality infrastructure** — 207 Vitest unit/integration tests with ≥80 %
  coverage gate on business logic; 10-spec Playwright E2E suite on a dedicated
  `hexprocure_e2e` database with deterministic seed and a mutation check that
  proves the suite can fail; CI pipeline (typecheck → lint → coverage tests →
  build → E2E → Docker image build)
- **Deployment** — multi-stage standalone Dockerfile, `compose.yaml` with
  Postgres 16 + OCR sidecar, healthchecks and persistent volumes; bare-metal
  guide with systemd/cron/nginx/TLS and a Compose variant

### Fixed

- GROUP BY errors on list/dashboard pages when joining suppliers (non-aggregated columns missing)
- Test isolation: shared truncate list now covers every schema table (API tokens, order templates, attachments, integration connections previously leaked across runs)
- Approval band boundaries: half-open ranges so €500.00 does not match two rules
- Budget TOCTOU: `SELECT … FOR UPDATE` on budget rows during PO ordering
- OCR extract: detached-call crash on the provider method, response-shape validation
- Migration journal regenerated after hand-written SQL was silently skipped by drizzle-kit on fresh databases
- nodemailer lazy-loading removed — Turbopack resolves require() statically

### Security

- Origin-check CSRF guard rejects browser mutations without a same-origin Origin header
- Per-class rate limiting returns 429 with Retry-After
- Passwords hashed with scrypt; sessions HMAC-signed with constant-time comparison; API tokens stored only as SHA-256 hashes
- gitleaks pre-commit hook active; secrets never committed (.env* ignored)

### Known gaps

- Single-currency display (EUR); money stored currency-aware
- Rate limiting is single-instance in-memory (Redis adapter door left open)
- QBO live OAuth push not wired (payload mappers ready; see docs/qbo-live-spec.md)
- Pull-based integration dispatch — schedule it with cron in production
- No payments execution; invoice approval is the end of the loop

[0.1.0]: https://github.com/maticijus/hexprocure/releases/tag/v0.1.0
