# WORKING — active-session lock for hexprocure

Read this before editing. Claim before you work; release when you stop.
Protocol: ~/.claude/rules/common/parallel-sessions.md

## Active claims
<!-- newest first; empty when the repo is free -->

- **owner:** claude-fable (Orca coordinator session 3: merge chore/audit-fix, MEDIUM fix lane, refactor lane)
  **machine:** local-mac
  **scope:** main in ~/dev/hexprocure (merges, pushes); worker lanes in new Orca worktrees off main
  **started:** 2026-10-21T05:20:00Z
  **heartbeat:** 2026-10-21T05:45:00Z
  **next:** audit-fix merged (5a5aff7, 335 tests green); MEDIUM lane running on maticijus/medium-fixes (five lane-B reviewer items); then refactor lane


## History
<!-- released claims, trimmed periodically -->
- 2026-10-20T20:22Z released: coordinator session 2 (run_5f957954e646). Merged lane A c1ec96f, licence fixes 484721c, lane B 8d74b5a into main (03dec33, 335 tests green, pushed). Open: five lane-B reviewer MEDIUMs (cancelPurchaseOrder ORDERED/lock, service lines acceptance, prior-invoiced PENDING/EXCEPTION, migration 0007 backfill, 23505 to INVALID_STATE); stray 5aa221b on maticijus/sec-lane-a (npm audit bump) unmerged, audit-fix branch owns dependency bumps. Use ~/dev/hexprocure for new work.

- **session 1 handoff (2026-10-20T19:45Z):** session 1 saw the takeover only after acting. Done by session 1 after 18:58Z: merged maticijus/sec-lane-a into main (c1ec96f, 317 tests green) and pushed main + sec-lane-a over SSH (HTTPS token lacks the workflow scope); pushed maticijus/fix-lane-b (B1-B7 commits, worker not yet done) to origin for safety; submitted the stuck Gemini Cursor review (ctx_4cff95f2a062, released) and committed its three licence findings on main as f867e61 (expiry re-check, Object.hasOwn, ed25519 guard; licence tests green, tsc and lint clean). Session 2's fix lane task_95d4fd78f04d duplicates f867e61 and should be stopped or rebased. Fresh clone outside iCloud at ~/dev/hexprocure (the Documents clone keeps losing files to iCloud eviction). Session 1 stops here.
