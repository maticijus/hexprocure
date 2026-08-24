# MVP3 Spec & Plan — Hardening, Surfaces, Release

Status: PLANNED · All items are **buildable without external access** (no credentials,
no third-party accounts, no hosting decisions). Derived from the post-MVP2 review.

## Sequencing rationale

```
§7 Machine tokens ──▶ unblocks unattended cron (ops wart)
§8 CSRF + rate limit ─▶ security foundation before more surface area
§9 Spend analytics ──▶ endpoints the new UI needs
§10 UI surfaces ─────▶ every shipped API becomes clickable
§11 Playwright E2E ──▶ covers the FINISHED UX, not a moving target
§12 Docker Compose ──▶ deployment parity
§13 Release v0.1.0 ──▶ tag what exists
```

Total ≈ 15–17 working days.

---

## §7 Machine API tokens — P0 · ~1 day

**Problem.** Unattended cron authenticates to `/integrations/dispatch` and
`/order-templates/run` with an admin's *session cookie* — it expires in 7 days
and shares privileges with a human account.

**Design.**
- Table `api_tokens`: `id, name, token_hash (sha256 hex, unique), user_id → users,
  created_at, last_used_at, revoked_at`. Plaintext token `hxp_<43 base62 chars>`
  is shown **once** at creation; only the hash is stored (same philosophy as passwords).
- `getActor()` gains a second authentication path: `Authorization: Bearer hxp_…`
  → hash lookup → acts as the owning user (with their role).
- Routes: `POST /auth/tokens` `{name}` (ADMIN) → plaintext response;
  `GET /auth/tokens` (list, no secrets); `DELETE /auth/tokens/:id` (ADMIN).
- Deployment guide §5.1 updated: cron uses `Authorization` header instead of cookies.

**Acceptance criteria.**
1. Created token authenticates dispatch/run endpoints without cookies.
2. Revoked token returns 401 immediately (hash absent).
3. Token plaintext never stored or logged (grep-test like the crypto suite).

## §8 CSRF protection + rate limiting — P1 · ~2 days

**Problem.** Known gaps: relies solely on `SameSite=Lax`; no request throttling.

**Design.**
- **CSRF (v1): origin-check middleware** — all non-GET requests must carry an
  `Origin` header matching the deployed host (`ALLOWED_ORIGIN` env, defaults to
  request host for localhost). Simple, no tokens, covers browsers; non-browser
  clients use Bearer tokens which are immune. Double-submit token documented as
  future hardening.
- **Rate limiting:** in-memory sliding window keyed by IP+class —
  auth endpoints 10/min · mutations 60/min · reads 300/min → `429` +
  `Retry-After`. Documented single-instance scope (target deployment is one box);
  Redis adapter interface left for later.

**Acceptance criteria.**
1. Cross-origin POST from a browser context is rejected 403 (test with forged Origin).
2. 11th rapid login attempt from one IP returns 429 + Retry-After (test).
3. Legitimate same-origin flows unaffected (full existing suite stays green).
4. Memory-bounded window store (no unbounded growth; tested with synthetic IPs).

## §9 Spend analytics — P1 · ~2 days

**Problem.** "Free addon" promised in positioning; currently only dashboard KPIs.

**Design.**
- `GET /api/v1/analytics/spend?groupBy=supplier|costCenter|category|month&from&to`
  (FINANCE/ADMIN) → `[{ key, totalMinor, documentCount }]`, sourced from approved
  invoices joined to POs/requisitions.
- `GET /api/v1/analytics/summary` → KPI block (total committed YTD, top supplier,
  budget utilization current month).
- UI: `/analytics` page — group-by selector, date range, horizontal CSS bar chart
  (zero chart dependencies), table beneath.

**Acceptance criteria.**
1. Aggregations correct against seeded multi-supplier/multi-month fixture (tests).
2. REQUESTER receives 403 on analytics endpoints.
3. Empty ranges return empty arrays, not errors.

## §10 UI surfaces for shipped APIs — P1 · ~4–5 days

Every MVP2 feature becomes operable without curl:

| Surface | Scope |
|---|---|
| Requisition form | per-line kind picker (GOODS/SERVICE) |
| PO view | kind badges, **Download PDF**, **Email to supplier** (confirm dialog shows resolved recipient), attachment chips |
| SERVICE lines | "Accept work" button (calls receipts with `accepted:true`) |
| Attachments | upload widget (drag-drop) + list/download/delete on requisitions, POs, invoices |
| Recurring templates | list + create form (cadence, start date, lines) + next-run column + "Run now" for ADMIN/FINANCE |
| Integrations | status card: CSV/webhook/email configured-state, QBO connect/disconnect/status (ADMIN) |

**Acceptance criteria.**
1. Each action reachable in ≤2 clicks from its list page.
2. Every mutation shows success/error feedback (reuse toast pattern).
3. Authz respected in UI (buttons hidden/disabled per role matrix).
4. Each page passes authenticated render check; component tests for forms.

## §11 Playwright E2E suite — P1 · ~3 days

**Design.**
- Config boots the app against a dedicated `hexprocure_e2e` database (migrations +
  deterministic seed in global setup), mirroring the `.env.test` isolation pattern.
- Specs: auth round-trip · full P2P happy path (rita requests → max approves →
  order → receive → fiona matches & approves invoice) · approval inbox actions ·
  PO PDF download (content-type assert) · attachment upload through the real
  file input · recurring template create + run · QBO status renders disconnected.
- CI: separate `e2e` job after unit gates (`npx playwright install --with-deps`).

**Acceptance criteria.**
1. Full suite green locally and in CI on every push.
2. Suite fails on deliberately broken matching logic (mutation check — proves it can fail).
3. Runtime < 3 minutes.

## §12 Docker Compose deployment parity — P2 · ~2 days

- Multi-stage `Dockerfile` for the app (Next `output: "standalone"`),
  `compose.yaml`: app + `postgres:16` volume + OCR sidecar; healthchecks;
  `env_file: .env`; same env contract as bare-metal guide.
- Deployment guide gains a "Compose variant" section replacing §2–§5 steps.

**Acceptance criteria.**
1. Fresh clone → `docker compose up -d` → migrations applied → login works.
2. Volumes persist across `down/up`.
3. CI builds the image (no push registry yet).

## §13 Release v0.1.0 — P2 · ~½ day

- `CHANGELOG.md` grouped from git history (Added / Fixed / Security / Known gaps).
- Version bump to 0.1.0, annotated tag, GitHub Release with notes linking specs.
- README status header moves from "MVP" to "v0.1.0".

**Acceptance criteria.**
1. Tag pushed; GitHub release published; CI green on the tag.
2. Fresh-clone quick start verified verbatim from the release notes.

---

## Out of scope (still)

T&M services, direct/materials procurement, payments execution, multi-currency
conversion, mobile apps, Redis-backed rate limiting, S3 storage driver — each has
a documented door but no spec until there's demand.
