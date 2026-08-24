# ProcureLite

SMB procure-to-pay: requisition → approval → PO → receipt → invoice matching, budget control, spend analytics.

## Stack

- Next.js 16 (App Router, `src/`), TypeScript strict
- PostgreSQL + Drizzle ORM
- Vitest (unit + integration), Playwright (E2E, later milestone)

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint
npx tsc --noEmit     # typecheck
npx vitest run       # all tests
npx vitest run --coverage  # with 80% gate on src/domain + src/lib
```

## Conventions

- **Dependency rule**: `app/ → lib/ → domain/`. Domain is pure — no I/O, no framework imports.
- **Money** is always integers in minor units via `src/domain/money.ts`. Never floats.
- Tests live next to code (`foo.ts`, `foo.test.ts`). TDD: RED→GREEN→REFACTOR with a commit per stage.
- No comments unless explaining *why*. Self-documenting names.
- Errors: domain throws typed errors; API routes map them to HTTP codes centrally.

## Definition of done (per feature)

1. Failing test written first and shown RED
2. Minimal implementation GREEN
3. `tsc --noEmit` + `npm run lint` clean
4. Coverage gate passes
5. Checkpoint commit(s) with evidence in message
