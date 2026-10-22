# Fact check of product copy, 2026-10-21

Lane F1, branch `maticijus/docs-fact-check`, base `origin/main` at 1449ccb (030f419 plus a lock commit).
Every sentence that claims a feature, number, route, limit, default, role rule or test count in the owned
files was checked against `src/`, `tests/`, `drizzle/`, `compose.yaml`, `package.json`, `.env.example`
and `scripts/`. 115 claims changed (rows below, excluding em-dash-only rows).

Evidence runs on this branch:
- `npx vitest run`: 50 test files, 421 tests (result in the worker report).
- `npx playwright test --list`: Total: 12 tests in 7 files.
- `package.json` version 0.1.0, git tag `v0.1.0`; `LICENSE` is MIT; `ee/LICENSE` is the draft HexProcure Commercial Licence.
- `docs/api-contract.md` now covers all 33 route files under `src/app/api/v1`, method and path.

## Code bugs found (reported to the coordinator, documented as they behave today)

1. The in-process dispatch scheduler (`src/instrumentation.ts`) never registers connectors. Connectors are
   registered only inside `POST /api/v1/integrations/dispatch` (`src/app/api/v1/integrations/dispatch/route.ts:26-44`),
   so the scheduler skips every event until that route has run in the same process. Listed under Known gaps.
2. The connector registry keeps one connector per event type and the last one registered wins
   (`src/lib/integrations/dispatch.ts:8-11`). With a webhook configured, `PO_CREATED` and `INVOICE_APPROVED`
   reach only the webhook, not QBO or CSV. Documented under Integrations.
3. The CSV connector renders rows and returns a byte count but writes no file and exposes none, yet marks
   events DELIVERED (`src/lib/integrations/csv.ts:91-101`). Listed under Known gaps.
4. `RATE_LIMIT_READ_PER_MIN` (default 300) is parsed but never applied: `src/middleware.ts:19-22` uses the
   60/min mutation limit for every API request except login and register. Docs now say so.
5. `.github/workflows/ci.yml` runs `npx drizzle-kit migrate`, which exits 1 silently with drizzle-kit 0.31.11.
6. `src/app/api/v1/integrations/dispatch/route.ts` has a dead statement `void hasHealthyQboConnection;`.

## Changes: OLD | NEW | proof

| File | OLD | NEW | Proof (file:line) |
|---|---|---|---|
| README.md | Lightweight, open procure-to-pay for SMBs: ... → ... [em dash] with | Open-source procure-to-pay for small and mid-sized businesses: ... with (adjective and em dash removed) | style rule; LICENSE (MIT) |
| README.md | v0.1.0 [em dash] feature-complete for the indirect procure-to-pay loop, in production use behind a reverse proxy | v0.1.0. The indirect procure-to-pay loop works end to end in the API and the UI | package.json:3; git tag v0.1.0; tests/e2e/happy-path-ui.spec.ts:23. "In production use" has no proof in the repo: removed, founder decision |
| README.md | with transparent, self-hosted simplicity | and runs on your own server | style rule (marketing adjectives); compose.yaml, docs/deployment.md |
| README.md | Only `MATCHED` invoices can be approved by finance | approved, by FINANCE or ADMIN | src/lib/services/p2p/invoices.ts:304 |
| README.md | Overlapping bands are rejected at configuration time; currency mixing between rules is rejected too | rejected when a requisition is submitted and its chain is resolved; no rule match cannot be submitted, no automatic escalation | src/domain/approval.ts:58-84 (no config-time validator exists) |
| README.md | Monthly budgets per cost center. | adds: ordering fails when the cost center has no budget for the current month | src/lib/services/p2p/purchase-orders.ts:26 |
| README.md | checked against three dimensions (table has four rows) | each goods line is checked four ways | src/domain/matching.ts:98-131 |
| README.md | QUANTITY_MISMATCH: invoiced quantity exceeds received quantity | cumulative invoiced quantity (this + prior) exceeds received | src/domain/matching.ts:106-114 |
| README.md | PRICE_MISMATCH: max(2%, €0.005 floor) | max(2% of the PO price, 0.5 minor units) (currency neutral) | src/domain/matching.ts:47-55 |
| README.md | (no service-line rule) | service lines: OVER_INVOICED_AMOUNT, SERVICE_NOT_ACCEPTED | src/domain/matching.ts:66-96 |
| README.md | Domain events (PO_CREATED, PO_CANCELLED, INVOICE_APPROVED) ... events cannot be lost | adds the 4 notification events; "a failed delivery does not lose the event" | src/lib/integrations/types.ts:3-10 |
| README.md | CSV flat-file: Wide-format rows ... | Renders rows ... Writes no file yet | src/lib/integrations/csv.ts:91-101 |
| README.md | QuickBooks Online mappers: QBO PurchaseOrder / Bill payloads | QuickBooks Online: OAuth connection, idempotent push (QBO_CLIENT_ID, QBO_CLIENT_SECRET) | src/app/api/v1/integrations/dispatch/route.ts:30-32; src/lib/integrations/qbo-connector.ts |
| README.md | (no routing rule) | one connector per event type, last registered wins; order CSV, email, QBO, webhook | src/lib/integrations/dispatch.ts:8-11; dispatch/route.ts:26-44 |
| README.md | Failed deliveries stay PENDING ... drain the outbox from an in-process scheduler | Failed retryable deliveries stay PENDING; scheduler depends on the dispatch route having run first | src/lib/integrations/dispatch.ts:55-70; src/instrumentation.ts:10-15 |
| README.md | confidence flag (HIGH = key fields found) | HIGH = total plus number or date found | src/lib/integrations/invoice-parser.ts:51-52 |
| README.md | node scripts/migrate.mjs (Quick start and Scripts) | node --env-file=.env scripts/migrate.mjs | scripts/migrate.mjs:4-10 (no dotenv) |
| README.md | npx vitest run # all tests | unit + integration tests (50 files, 421 tests) | `npx vitest run` on this branch |
| README.md | npm run test:e2e # ... hexprocure_e2e DB | 12 tests in 7 files ... DB from .env.e2e | `npx playwright test --list`; scripts/e2e-env.ts:2 (DB name not in repo) |
| README.md | Known gaps: ... need the Redis adapter | need a Redis adapter, which does not exist yet; plus scheduler and CSV gaps | src/lib/api/request-guards.ts (in-memory Map); coordinator decision 2026-10-21 |
| README.md | Paid features (AI lanes, connector packs, SSO and more) live in ee/ ... unlock with ... HEXPROCURE_LICENSE | ee/ holds the draft licence and the feature-to-tier map; no feature is gated yet; key verified against HEXPROCURE_LICENSE_PUBLIC_KEY; GET /api/v1/license | ee/features.ts:3-21 (isFeatureEnabled unused in src/); src/lib/license.ts:70-82; src/app/api/v1/license/route.ts |
| README.md | em dashes | 9 replaced in owned sections; README count now 0 | grep |
| docs/architecture.md | lib/ Adapters (db client, repos). Thin | services/, integrations/, db/, api/; integration-tested against Postgres | src/lib/* |
| docs/architecture.md | app/ ... delegates to domain | delegates to lib services | src/app/api/v1/*/route.ts imports @/lib/services |
| docs/architecture.md | (domain list) | adds invoice-lines.ts | src/domain/invoice-lines.ts:58 |
| docs/architecture.md | routes to the first matching rule's approver role. Amounts above all rule ceilings escalate to ADMIN | one bounded band plus open-ended rules; no match cannot be submitted; no automatic escalation | src/domain/approval.ts:75-95 |
| docs/architecture.md | status: MATCHED / QUANTITY_MISMATCH / ... | status MATCHED or EXCEPTION, with goods and service exception types | src/domain/matching.ts:24-45,66-131 |
| docs/architecture.md | exceptions route to reviewer | EXCEPTION invoices stay open for review and can be re-matched | src/lib/services/p2p/invoices.ts (no reviewer routing) |
| docs/architecture.md | Integration: API routes against real Postgres (local dev instance) | real Postgres test DB hexprocure_test via .env.test | scripts/test-env.ts; vitest.config.ts:8; CLAUDE.md |
| docs/architecture.md | E2E (Playwright): later milestone | 12 tests in 7 files incl. UI happy path | tests/e2e/happy-path-ui.spec.ts:23 |
| docs/architecture.md | ≥80% coverage gate | 80% thresholds over src/domain, src/lib/services, src/lib/api | vitest.config.ts:14-16 |
| docs/deployment.md | `node scripts/migrate.mjs  # applies` (3.2, 8) | `node --env-file=.env scripts/migrate.mjs` | scripts/migrate.mjs does not load .env |
| docs/deployment.md | "Open the site → register your account" | register via `POST /api/v1/auth/register` with Origin header; needs `ALLOW_SELF_REGISTRATION=true` in production | src/app/login/page.tsx (no register form); src/lib/services/auth.ts:11-14; src/lib/api/request-guards.ts (Origin required) |
| docs/deployment.md | (env table missing) | added ALLOW_SELF_REGISTRATION, TRUST_PROXY, INTEGRATION_DISPATCH_INTERVAL_MS, QBO_SANDBOX rows | .env.example; src/lib/api/request-guards.ts:10; src/instrumentation.ts:7 |
| docs/deployment.md | `for §6` (3 rows, plus "when §6 lands") | `for QuickBooks` | §6 is the reverse proxy; QBO vars are used in src/app/api/v1/integrations/qbo |
| docs/deployment.md | "Escalation rule of thumb: amounts above the highest band ceiling route to FINANCE" | no automatic escalation; error "No approval rule matches this amount"; open-ended rules add steps; boundary and overlap rules | src/domain/approval.ts (fact sheet) |
| docs/deployment.md | "approval rules currently via DB insert ...; UI is roadmap" | no UI or API for suppliers, cost centers, budgets, approval rules: SQL | no such routes in src/app/api/v1 |
| docs/deployment.md | "enforced per endpoint and in the UI" | "Rows marked any user are not role-checked by the API" | src/lib/services/p2p/invoices.ts (matchInvoiceById has no role check); receipts, requisitions routes have none |
| docs/deployment.md | Match invoices `– – ✓ ✓` | `✓ ✓ ✓ ✓ (any user)` | src/lib/services/p2p/invoices.ts:255; src/app/(app)/invoices/[id]/page.tsx:105 |
| docs/deployment.md | Send PO `(*any authenticated can POST; transport must be configured)` | UI shows action to FINANCE/ADMIN only; API accepts any authenticated user; SMTP required | src/app/(app)/purchase-orders/page.tsx:14; src/app/api/v1/purchase-orders/[id]/send/route.ts |
| docs/deployment.md | "Approve/reject own band's items" | "items whose rule names your role" | src/lib/services/p2p/requisitions.ts:110 |
| docs/deployment.md | `-H "cookie: <your admin session>"` | adds `origin` header and `hexprocure_session=` cookie name | src/lib/api/request-guards.ts (missing Origin = 403); src/lib/auth.ts:68 |
| docs/deployment.md | `{"id":"…","plaintext":"hxp_…"}` | `{"id":"…","name":"cron","plaintext":"hxp_…"}` | src/lib/services/api-tokens.ts:26 |
| docs/deployment.md | "`GET/DELETE /api/v1/auth/tokens`" | `GET /api/v1/auth/tokens` and `DELETE /api/v1/auth/tokens/:id` (ADMIN only) | src/app/api/v1/auth/tokens/route.ts; tokens/[id]/route.ts |
| docs/deployment.md | nginx block without forwarded-for | added `X-Forwarded-For $proxy_add_x_forwarded_for`, TRUST_PROXY paragraph (rate limits corrected in a later row) | src/lib/api/request-guards.ts:10,82-84 |
| docs/deployment.md | `/opt/hexprocure/.data/uploads` (backup) | `/opt/hexprocure/app/.data/uploads` | src/lib/services/attachments.ts:23 (relative to app cwd /opt/hexprocure/app) |
| docs/deployment.md | `Docker Engine ≥ 24`; "Port 3000 free" | removed version; added APP_PORT | compose.yaml (no version pin; ports APP_PORT) |
| docs/deployment.md | `AUTH_SECRET` (`openssl rand -base64 32`) in 9.2 | `openssl rand -hex 32` (consistent with 3.1, .env.example) | .env.example; src/lib/auth-secret.ts |
| docs/deployment.md | `attachments (DATA_DIR)` | mounted at default DATA_DIR `/app/.data/uploads` | compose.yaml volumes |
| docs/deployment.md | `docker compose pull && docker compose up -d --build   # update` | `git pull && docker compose up -d --build` | compose.yaml (app, migrate are built, not pulled) |
| docs/deployment.md | ufw: "app (3000) and OCR (8100) bound to 127.0.0.1" | only OCR bound to 127.0.0.1; Compose publishes app on all interfaces | docs 5.2 `-p 127.0.0.1:8100`; compose.yaml ports "${APP_PORT:-3000}:3000" |
| docs/deployment.md | (checklist) | added ALLOW_SELF_REGISTRATION removal item; Compose first-admin psql via `docker compose exec db` | src/lib/services/auth.ts |
| docs/deployment.md | em dashes | 6 em dashes replaced (colon, period, comma, "to"); count now 0 | n/a |
| docs/deployment.md | "the app drains the integration outbox itself ... no cron entry or machine token needed"; "Use either the scheduler or the cron line, not both"; Compose "dispatch cron line is not needed" | scheduler delivers nothing until the dispatch route has run in-process; keep the cron call; connector order and last-wins; CSV writes no file | src/app/api/v1/integrations/dispatch/route.ts:26-44; src/lib/integrations/dispatch.ts:8-11; src/lib/integrations/csv.ts:91-101 |
| docs/deployment.md | rate limits (per minute: 10 for auth, 60 for mutations, 300 for reads ... RATE_LIMIT_READ_PER_MIN) | 10 for login and register, 60 for every other API request, reads included; RATE_LIMIT_READ_PER_MIN is parsed but not applied | src/middleware.ts:19-22 |
| docs/api-contract.md | Auth: session cookie (v1: single-tenant, simple login) | session cookie or Bearer hxp_ token; unauthenticated gives 403 | src/lib/api/helpers.ts:41-62 |
| docs/api-contract.md | 401 unauthenticated, 422 domain rule (status list) | 400/402/403/404/409/422(BUDGET_EXCEEDED only)/429/501/503/500 with codes | helpers.ts:11-19, src/middleware.ts:44 |
| docs/api-contract.md | `GET /requisitions` / `GET /requisitions/:id` | removed (no route) | route list |
| docs/api-contract.md | `GET /purchase-orders/:id` | removed (no route) | route list |
| docs/api-contract.md | `PUT /cost-centers/:id/budget` | removed (no route); note budgets/rules have no API | route list |
| docs/api-contract.md | Requisition body without kind/default currency | added `kind?`, `currency` defaults EUR, supported list | requisitions/route.ts:28-41, format.ts:3 |
| docs/api-contract.md | DRAFT→submitted resolves chain | 409 cases; no-rule-match is plain Error, 500 INTERNAL | requisitions.ts:21-33, approval.ts:85 |
| docs/api-contract.md | decide "(approver only)" | role on step or ADMIN, 409 if decided | requisitions.ts:110-115 |
| docs/api-contract.md | order: submitted+fully-approved → PO | APPROVED requisition (becomes ORDERED); no budget for month = 409 INVALID_STATE; no role check | purchase-orders.ts:26,57,140 |
| docs/api-contract.md | cancel: releases reservation | also returns requisition to APPROVED | purchase-orders.ts:183-188 |
| docs/api-contract.md | receipts service body `{poLineId, accepted:true}, no quantities` | quantityReceived still required by validation (use 0) | receipts/route.ts:28-37 |
| docs/api-contract.md | match: "422-style payload" | returns 200 `{status, exceptions}` | invoices.ts (matchInvoice return), match/route.ts |
| docs/api-contract.md | approve: only when MATCHED | plus FINANCE/ADMIN only | invoices.ts:304 |
| docs/api-contract.md | integrations dispatch roles unstated | ADMIN/FINANCE; timer note | dispatch/route.ts:15 |
| docs/api-contract.md | Status machine PO `OPEN → RECEIVED(partial|full) → CLOSED` | `OPEN → CLOSED`, `OPEN → CANCELLED`; no RECEIVED | schema.ts:19 |
| docs/api-contract.md | Requisition: no ORDERED | added APPROVED → ORDERED and back on cancel | schema.ts:11-17, purchase-orders.ts:57,185 |
| docs/api-contract.md | Invoice machine | APPROVED only from MATCHED; approved cannot be re-matched | invoices.ts:259,310 |
| docs/api-contract.md | AuthZ: Approve "Manager (own reports)" | steps routed to that role, ADMIN any | requisitions.ts:110 |
| docs/api-contract.md | AuthZ: Invoice match/approve FINANCE/ADMIN | create/match any user; approve FINANCE/ADMIN | invoices.ts:304 (no other guard) |
| docs/api-contract.md | AuthZ: Set budgets / rules ADMIN | row removed (no API); added cancel, analytics, dispatch, tokens/QBO/licence, attachment delete rows | route guards |
| docs/api-contract.md | analytics groupBy `supplier|category|costCenter` | `supplier|costCenter|month`, FINANCE/ADMIN | analytics/spend/route.ts:6-27 |
| docs/functional-spec.md | REQUESTER/MANAGER/FINANCE/ADMIN role table text | corrected per actual guards (order, send, receive, invoice create/match open to all; cancel MANAGER+; approve invoice FINANCE/ADMIN; ADMIN also licence, session revoke) | see api-contract matrix |
| docs/functional-spec.md | HMAC-SHA256 signed session cookie (7 days...), plus | add server-side sessions row, revocable | sessions.ts, drizzle/0009 |
| docs/functional-spec.md | auth 10/min, mutation 60/min, read 300/min | login 10/min, all other /api 60/min (read limit defined but unused by middleware) | middleware.ts:20-23, request-guards.ts:76-85 |
| docs/functional-spec.md | rejected at rule configuration | rejected when chain resolved on submit | requisitions.ts:44-56, approval.ts |
| docs/functional-spec.md | Approvers see only their role's tasks | tasks routed to their role | approvals/page.tsx:20 |
| docs/functional-spec.md | PATCH /purchase-orders/:id/lines | GET /purchase-orders/:id/lines; no-budget 409 | lines/route.ts |
| docs/functional-spec.md | max(2 %, 0.005 EUR) | max(2 %, 0.5 minor units); cumulative qty; service exceptions | matching.ts:47-131 |
| docs/functional-spec.md | No LLM is involved | LLM line extraction when ANTHROPIC_API_KEY set | invoices/extract/route.ts:78-110, llm-provider.ts:22 |
| docs/functional-spec.md | Display assumes EUR | six currencies, per-currency digits | format.ts:3 |
| docs/functional-spec.md | Dispatch is pull-based | plus in-process timer; connector registration caveat; routing rules; CSV writes no file | instrumentation.ts:7, dispatch/route.ts:26-44, dispatch.ts:8, csv.ts:91-101 |
| docs/functional-spec.md | live sync not wired because Intuit credentials are missing | qbo_sync_map refs; not yet run against live sandbox | qbo-connector.ts, schema qbo_sync_map |
| docs/functional-spec.md | analytics/summary: approved total, open requisitions, budget vs reserved, exceptions | totals per currency and top suppliers | analytics.ts:87-120 |
| docs/functional-spec.md | UI surfaces list | detail/new pages listed per directory | src/app/(app)/* |
| docs/functional-spec.md | API table: GET requisitions, GET invoices, PATCH lines | removed/replaced; added GET attachments, cancel, lines GET, sessions revoke, license | route list |
| docs/functional-spec.md | Data model | added sessions, llm_usage | schema.ts, drizzle/0006,0009 |
| docs/functional-spec.md | Vitest 30 files, 207 tests; coverage 86.6 % etc.; Playwright 7 specs; tsc clean | 50 files / 421 tests, thresholds 80 %; 12 tests in 7 files; migrations 0000..0009 | `npx vitest run` (50 files, 421 tests); `npx playwright test --list`; vitest.config.ts:14-16; drizzle/ |
| docs/functional-spec.md | Section 9 gaps (sessions, QBO, scheduler, EUR, ...) | rate limiter, Intuit live smoke + HTTPS redirect URI, scheduler does not register connectors, CSV writes no file | src/lib/api/request-guards.ts; tests/live/qbo-live.test.ts; src/instrumentation.ts; src/lib/integrations/csv.ts:91-101 |
| both | em dashes | 0 remain (api-contract had many; functional-spec had none) | grep |
| docs/api-contract.md | Drains outbox through registered connectors (CSV, webhook, email notifications, QBO when connected). Also runs on a timer when INTEGRATION_DISPATCH_INTERVAL_MS is set. | Registers connectors (one per event type, last wins) and drains up to 100 events; the timer delivers only after this route ran in the same process | src/app/api/v1/integrations/dispatch/route.ts:19,26-44; src/lib/integrations/dispatch.ts:8-11,24; src/instrumentation.ts:10-15 |
| docs/mvp2-spec.md | `§6 specced separately in [qbo-live-spec.md]` | `§6 BUILT against a stubbed Intuit layer, live sandbox smoke NOT run (see ... §12)` | src/app/api/v1/integrations/qbo/*/route.ts; src/lib/integrations/qbo-connection.ts; tests/live/qbo-live.test.ts not run (no credentials) |
| docs/mvp2-spec.md | `Current QBO mappers produce payloads; OAuth client + token storage + sync status UI are missing.` | `Status: BUILT (OAuth client, encrypted token storage, connector, status card); not verified against a real Intuit sandbox.` | src/lib/integrations/qbo-connection.ts, qbo-connector.ts; src/components/QboStatusCard.tsx; drizzle/0004_qbo.sql |
| docs/mvp3-spec.md | `Status: PLANNED` | `Status: §7–§13 SHIPPED in v0.1.0 (tag v0.1.0)` | git tag v0.1.0 (pushed, origin); src/app/api/v1/auth/tokens; src/middleware.ts + src/lib/api/request-guards.ts; src/app/api/v1/analytics/spend; src/app/(app)/analytics; playwright.config.ts (12 tests in 7 files); compose.yaml, Dockerfile, .github/workflows/ci.yml:37,72; CHANGELOG.md:6 |
| docs/ai-roadmap.md | `(first lane, specced)` | `(first lane, shipped)` | src/lib/integrations/llm-provider.ts:129; src/app/api/v1/invoices/extract/route.ts |
| docs/ai-roadmap.md | `Today extraction returns four header fields;` | `Header extraction returns number, date, total and VAT ID only; ... Lines now come from the LLM when ANTHROPIC_API_KEY is set (linesSource "llm"); otherwise "none".` | src/lib/integrations/invoice-parser.ts:54; llm-provider.ts:232-236; extract/route.ts |
| docs/ai-roadmap.md | `Lane 1 ... (now)` / `Lane 2 ... (next)` | `(shipped)` / `(planned)` | no triage code in src or ee |
| docs/ai-roadmap.md | (none) | added paragraph after Sequencing: only lane 1 exists; ee/features.ts maps ai-triage, ai-duplicates (team), ai-drafting, ai-categorisation, ai-anomaly (business) but isFeatureEnabled is not called in src/; lane 1 not licence-gated | ee/features.ts:3-8,18; grep isFeatureEnabled src = none |
| docs/ai-roadmap.md | `Adaptive thinking stays on; effort low for extraction and classification, medium for triage text. Prompt caching on the system prompt and the PO context.` | `No thinking parameter is set in code. Effort is low for extraction (shipped)... Prompt caching (cache_control) is set on the system prompt only. ... ANTHROPIC_API_KEY ... INTEGRATION_LLM_MODEL ... llm_usage` | llm-provider.ts:142-160 (no thinking, cache_control only on system); :22,:233-234; src/lib/integrations/llm-usage.ts |
| docs/open-source-gtm.md | `community QBO and Xero connectors, read-only MCP server` (tree) | `email, BYOK lane 1, QBO connector (exists today). Planned, not in the repo: Xero connector, read-only MCP server` | src/lib/integrations/ has csv, webhook, email, qbo-connector only; no xero/mcp in src, ee, services |
| docs/open-source-gtm.md | ee/ tree: `ai/`, `connectors/`, `mcp-write/`, `sso/, audit-export/` presented as existing | marked planned; added `README.md, features.ts exist today` and `(draft for legal review)` | find ee -type f = LICENSE, README.md, features.ts, features.test.ts; ee/LICENSE:1 |
| docs/open-source-gtm.md | `Ed25519 public key committed here` | `public key is read from HEXPROCURE_LICENSE_PUBLIC_KEY` | src/lib/license.ts getLicense (env HEXPROCURE_LICENSE_PUBLIC_KEY) |
| docs/open-source-gtm.md | `Public key in the repo` | `HEXPROCURE_LICENSE_PUBLIC_KEY env var (not committed) ... scripts/license-sign.ts signs test tokens` | src/lib/license.ts; scripts/license-sign.ts |
| docs/open-source-gtm.md | `Trademark ... TRADEMARK.md` | `(not yet in the repo)` | ls TRADEMARK.md: absent |
| docs/open-source-gtm.md | `ee/ features render as locked with an upgrade link` | `Planned, not built ... no feature is gated yet; isFeatureEnabled is not called in src/` | grep isFeatureEnabled src = none |
| docs/open-source-gtm.md | `Build flag HEXPROCURE_EDITION=community excludes ee/ ...` | `Planned, not built` | grep HEXPROCURE_EDITION across repo = none |
| docs/open-source-gtm.md | `Usage counters ... cap is enforced` | `Planned ... llm_usage exists and logs every LLM call. aiDocsPerMonth is parsed from the licence but not enforced.` | src/lib/license.ts toLicense; grep aiDocsPerMonth src = license.ts only; schema llmUsage |
| docs/open-source-gtm.md | `Add SECURITY.md with a private disclosure address, and fix` | `SECURITY.md exists (address is a placeholder the founder must confirm). Fix` | SECURITY.md:12-14 |
| docs/open-source-gtm.md | `Build lane dispatched the same day (branch ee-license).` | `+ Landed so far: src/lib/license.ts, GET /api/v1/license, ee/LICENSE (draft), ee/features.ts. No paid feature code exists and nothing is gated.` | src/lib/license.ts; src/app/api/v1/license/route.ts; ee/ |
| docs/open-source-gtm.md | `ee/ licence text: adapt PostHog's or Cal.com's, or have counsel draft one.` | `ee/LICENSE is a draft for legal review; ... draft the final one.` | ee/LICENSE:1 ("Draft for legal review") |
| docs/open-source-gtm.md | `DCO versus CLA for contributions.` | `+ (CONTRIBUTING.md currently requires a DCO sign-off)` | CONTRIBUTING.md:9-15 |
| docs/qbo-live-spec.md | `the PO mapper emits VendorRef as a plain string, while the QBO API expects { "value": "<vendor id>" }` | `emits VendorRef as { "value": <supplier>, "name": <supplier> } ... where <supplier> is the HexProcure supplier name ... while the QBO API expects the vendor id in value` | src/lib/integrations/qbo.ts:36,70; src/lib/services/p2p/purchase-orders.ts:75 (supplier: supplierRow?.name) |
| docs/brief.md | (none) | added `Prices as researched on unknown; verify before quoting.` after line 6 | file has no date and cites no source |
| docs/pricing-tiers.md | (none) | added `Prices as researched on 2026-10-20; verify before quoting.` under section 5 header | cites research/market-2026-10-20.md at line 61 |
| docs/mvp2-spec.md, mvp3-spec.md, ai-roadmap.md, open-source-gtm.md, qbo-live-spec.md s12 | em dashes | none needed on changed lines; counts after: mvp2 14, mvp3 14, ai-roadmap 0, gtm 0, qbo-live 4 (all outside section 12), brief 1, pricing 0 | grep -c |

## Routes added and removed in docs/api-contract.md

Removed (no route on disk): `GET /requisitions`, `GET /requisitions/:id`, `GET /purchase-orders/:id`, `PUT /cost-centers/:id/budget`.
Added: `POST /auth/register`, `POST /auth/login`, `GET /auth/tokens`, `POST /auth/tokens`, `DELETE /auth/tokens/:id`,
`GET /purchase-orders/:id/lines`, `POST /invoices/extract`, `GET /attachments`, `GET /integrations/qbo/connect`,
`GET /integrations/qbo/callback`, `POST /integrations/qbo/disconnect`, `GET /integrations/qbo/status`,
`GET /analytics/summary`, `GET /meta/options`, `GET /meta/entities`, `GET /license`, and `GET /api/health` (outside `/api/v1`).

## Market and competitor claims for the founder (not rewritten)

"Prices as researched on <date>; verify before quoting" was added to `docs/brief.md` (date unknown) and
`docs/pricing-tiers.md` (2026-10-20, from the cited `docs/research/market-2026-10-20.md`).
`docs/open-source-gtm.md` quotes no competitor prices.

docs/brief.md
- L5-6: "Enterprise tools (Coupa ~$2.5k/mo, Procurify ~$1–2k/mo) are overkill; Precoro ($499/mo) is the current floor for real P2P."

docs/pricing-tiers.md
- L13: "The brief fixes the current floor at Precoro at roughly 499 USD per month."
- L53: "99 and 299 EUR are anchors chosen to sit under Precoro and above tooling like Zahara or ProcurementExpress"
- L66: "Pleo | 4 to 249 EUR per month base, plus 5 to 15 EUR per extra user"
- L67: "Payhawk | from 149 EUR per month (small-company programme, no procurement)"
- L68: "Spendesk | quote; example 299 EUR per month at 100 transactions"
- L69: "Precoro | 35 USD per user or 499 to 999 USD flat, sources conflict" (conflicts with brief "$499/mo")
- L70: "Procurify | about 1,000 USD per month, quote" (brief says ~$1-2k)
- L73: "Odoo Purchase | 17 to 61 USD per user per month"
- Ramp row (L65): "free; Plus 15 USD per user per month plus platform fee"
- L78: "99 and 299 EUR flat per company undercut every dedicated P2P tool (Precoro, Procurify, Kissflow) and match the spend-card players (Pleo Advanced 99, Pleo Business 249, Payhawk 149)"
- L79: "A 30-person company on Odoo Purchase pays 500 to 1,800 USD per month; on Precoro per-user, over 1,000 USD."
- L82: "No open-source dedicated P2P exists. Odoo Community and ERPNext are general ERPs. HexProcure is alone in its niche; ... ERPNext style"
(line numbers are pre-edit; the new date line shifted later lines by 2)

docs/open-source-gtm.md (no competitor prices; no date line needed)
- L39-40: "This is the PostHog and Cal.com shape (MIT or AGPL core plus `ee/`), and it is how Twenty and Plane ship too."
- L60-61: "AGPL scares exactly the SME IT people we want to self-host, and no hosting competitor is going to clone an SME P2P tool."
- L62: "modelled on the PostHog or Cal.com enterprise licence text"
- L123-124: "Comparison pages in the docs: HexProcure versus Precoro, Procurify, Odoo Purchase, using the benchmarks in `research/market-2026-10-20.md`."
- L44-46 (section 2): "An SME finance team does not fork a repo to strip a licence check; the ones who would were never going to pay." (assertion)
- docs/ai-roadmap.md L90: "30-day retention on Anthropic's side" (vendor policy, not checked)

Also in README "Why": "Enterprise suites cost thousands per month and take weeks to implement." (left as is).

## Founder decisions

- README said "in production use behind a reverse proxy". Nothing in the repo proves it, so it was removed.
  Put it back only with a named deployment you can point to.
- `brief.md` and `pricing-tiers.md` disagree on Precoro and Procurify prices.
- `pricing-tiers.md` lists Xero, Sage, Pohoda and DATEV connectors as community maintained; none exist in code.

## Errors outside this lane's ownership

- README `## Auth` says "Email + password registration": there is no registration form in the UI; registration is API only (`POST /api/v1/auth/register`).
- `ee/README.md` says the directory "holds the paid features"; it holds only the licence, README and the feature-to-tier map, and nothing is gated.
- `.env.example` header says "Copy to .env.local"; Compose, `scripts/migrate.mjs` usage and the docs use `.env`.
- `docs/qbo-live-spec.md` line 3 "Status: READY TO BUILD" is stale; section 3 shows `bytea` columns and an `enc:v1:` envelope, code uses `text` and a `v1:` prefix; sections 8 and 9 cite a `test:contract` script that does not exist (it is `npm run test:qbo-live`).
- `docs/mvp2-spec.md` and `docs/mvp3-spec.md` bodies are still written as plans (only status markers were in scope).

## Proposed GitHub About text

Current: "Open-source SMB procure-to-pay: requisitions, approvals, POs, invoice matching, budget control, ERP integrations"

Proposed: "Open-source, self-hosted procure-to-pay for small businesses: requisitions, rule-based approvals, purchase orders, goods receipt, 2/3-way invoice matching, budget control, QuickBooks Online and webhook integrations, OCR invoice intake. MIT."

## Residual em dashes in owned files

`docs/architecture.md` line 1 (H1, reserved for the diagram lane, not touched). Em dashes in `docs/brief.md` (1),
`docs/mvp2-spec.md` (14), `docs/mvp3-spec.md` (14) and `docs/qbo-live-spec.md` (4) were replaced by colons in a
punctuation-only commit; no wording changed. All other touched files: 0.
