# HexProcure

Lightweight, open procure-to-pay for SMBs: requisitions → rule-based approvals → purchase orders → goods receipt → invoice matching, with budget control and ERP/AP integrations.

**Status:** MVP / not production-hardened. See [Known gaps](#known-gaps) before deploying.

## Features

- **P2P core** — requisitions with line items, amount-banded approval chains with escalation, PO generation, partial/full goods receipt, invoice capture with 2/3-way matching (quantity, cumulative over-invoicing, price tolerance)
- **Budget control** — monthly budgets per cost center; POs reserve budget atomically (`SELECT … FOR UPDATE`), cancellation releases
- **Integrations** — transactional outbox + pluggable connectors: universal CSV flat-file export, HMAC-signed generic webhooks, QuickBooks Online payload mappers
- **Auth** — email/password (scrypt), HttpOnly HMAC-signed session cookies
- **UI** — Coupa-inspired: dashboard KPIs, approval inbox, list views with status pills

## Stack

Next.js 16 (App Router) · TypeScript · PostgreSQL · Drizzle ORM · Tailwind CSS 4 · Vitest

## Quick start

Prereqs: Node 22+, a local PostgreSQL.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL / AUTH_SECRET
npx drizzle-kit migrate         # apply schema to your database
npx tsx scripts/seed.ts         # demo users + data
npm run dev                     # http://localhost:3000/login
```

Demo logins (password `password123`): `rita@hexprocure.dev` (requester), `max@…` (manager), `fiona@…` (finance), `admin@…` (admin).

## Scripts

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint
npx tsc --noEmit     # typecheck
npx vitest run             # all tests
npx vitest run --coverage  # with coverage gate on business logic
```

Tests use their own database via `.env.test` so they never touch dev data.

## Architecture

```
src/
  domain/       Pure business logic (money, approvals, budgets, matching). No I/O.
  lib/
    services/   Transactional flows wiring domain ↔ Postgres
    api/        Auth + error mapping for route handlers
    integrations/ Outbox dispatch + connectors (CSV, webhook, QBO mappers)
    db/         Drizzle schema + client
  app/          Next.js routes & API handlers (thin adapters)
```

Dependency rule: `app → lib → domain`; the domain layer is pure and fully unit-tested. API contract and product brief live in [`docs/`](docs/).

## Known gaps

- No CSRF tokens beyond `SameSite=Lax` cookies; no rate limiting
- Session revocation (stateless tokens until a session store lands)
- QBO connector ships payload mappers only — OAuth client not implemented
- Integration dispatch is pull-based (`POST /api/v1/integrations/dispatch`) — needs a scheduler in production
- Single-currency display (EUR); money stored currency-aware but UI assumes EUR

## License

MIT — see [LICENSE](LICENSE).
