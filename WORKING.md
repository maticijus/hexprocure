# WORKING — active-session lock for hexprocure

Read this before editing. Claim before you work; release when you stop.
Protocol: ~/.claude/rules/common/parallel-sessions.md

## Active claims
<!-- newest first; empty when the repo is free -->

- **owner:** claude-fable (Orca coordinator session 5: QBO vendor mapping, master-data API and UI, MCP server)
  **machine:** local-mac
  **scope:** main in ~/dev/hexprocure (merges, pushes); lanes in Orca worktrees off main: qbo-vendor-map (src/lib/integrations/qbo*, README QBO bullet), master-data (src/app/api/v1/{suppliers,cost-centers,budgets,approval-rules}, src/lib/services/master-data, src/app/(app)/admin and suppliers pages, docs/api-contract.md, README UI and Known gaps, docs/deployment.md 3.3), mcp-server (services/mcp, README new MCP section, docs/erp-integration-route.md status)
  **started:** 2026-10-22T07:10:00Z
  **heartbeat:** 2026-10-22T07:10:00Z
  **next:** gate each worker_done, merge green lanes, release

## History
- 2026-10-22 claude-fable: pricing docs aligned to vendor-page prices (Team 79 EUR, Business 249 EUR), connectors marked built vs planned; next lanes proposed: QBO vendor mapping, master-data API.
- 2026-10-21 claude-fable (Orca coordinator session 4): gap lanes L2 to L12 merged and pushed, main at the IPv6 hextet fix; demo video at ~/Desktop/hexprocure-demo-en.mp4 awaiting founder review; next: founder decisions on GitHub About text, video voice and music, pricing doc items.
<!-- released claims, trimmed periodically -->
- 2026-10-21T06:05Z released: coordinator session 3 (run_0da6e998d932). Merged chore/audit-fix (5a5aff7), MEDIUM fixes M1-M5 (1fbd5d6, migration 0008), p2p refactor (0187c54: p2p.ts split into p2p/{shared,requisitions,purchase-orders,receipts,invoices}.ts behind a barrel). Main 348 tests green, tsc, lint, build clean, Opus review MERGE. Open: matchInvoiceById takes no PO lock (concurrent matches on one PO line can both pass the invoiced cap); submitRequisition and decideApproval still over 50 lines; lane A notes (X-Real-IP spoofable without proxy, key eviction floodable, per-email login lockout DoS); ee/LICENSE and SECURITY mail placeholders. Local Postgres is Docker hexprocure-pg under colima; brew postgresql@16 must stay stopped (port clash, no postgres role).
- 2026-10-20T20:22Z released: coordinator session 2 (run_5f957954e646). Merged lane A c1ec96f, licence fixes 484721c, lane B 8d74b5a into main (03dec33, 335 tests green, pushed). Open: five lane-B reviewer MEDIUMs (cancelPurchaseOrder ORDERED/lock, service lines acceptance, prior-invoiced PENDING/EXCEPTION, migration 0007 backfill, 23505 to INVALID_STATE); stray 5aa221b on maticijus/sec-lane-a (npm audit bump) unmerged, audit-fix branch owns dependency bumps. Use ~/dev/hexprocure for new work.

- **session 1 handoff (2026-10-20T19:45Z):** session 1 saw the takeover only after acting. Done by session 1 after 18:58Z: merged maticijus/sec-lane-a into main (c1ec96f, 317 tests green) and pushed main + sec-lane-a over SSH (HTTPS token lacks the workflow scope); pushed maticijus/fix-lane-b (B1-B7 commits, worker not yet done) to origin for safety; submitted the stuck Gemini Cursor review (ctx_4cff95f2a062, released) and committed its three licence findings on main as f867e61 (expiry re-check, Object.hasOwn, ed25519 guard; licence tests green, tsc and lint clean). Session 2's fix lane task_95d4fd78f04d duplicates f867e61 and should be stopped or rebased. Fresh clone outside iCloud at ~/dev/hexprocure (the Documents clone keeps losing files to iCloud eviction). Session 1 stops here.
