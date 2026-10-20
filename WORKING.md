# WORKING — active-session lock for hexprocure

Read this before editing. Claim before you work; release when you stop.
Protocol: ~/.claude/rules/common/parallel-sessions.md

## Active claims
<!-- newest first; empty when the repo is free -->

- **owner:** claude-fable (Orca coordinator session 2, taken over from coordinator session 1 at founder's request 2026-10-20T18:58Z; session 1 may still be open, do not act on run_5f957954e646 from it)
  **machine:** local-mac
  **scope:** main (merged feat/ai-roadmap, maticijus/ai-line-items, maticijus/ee-license); fix lanes in Orca worktrees sec-lane-a and fix-lane-b off main
  **started:** 2026-10-20T16:05:00Z
  **heartbeat:** 2026-10-20T18:58:00Z
  **next:** lane A merged and pushed (c1ec96f, 317 tests green); lane B (money integrity) B1-B3 done in fix-lane-b, B4 running; Cursor review of licence gate done (3 findings), fix lane task_95d4fd78f04d running in ee-license worktree; then merge B and licence fixes, return docs/security-review to main, release lock

## History
<!-- released claims, trimmed periodically -->

- **session 1 handoff (2026-10-20T19:45Z):** session 1 saw the takeover only after acting. Done by session 1 after 18:58Z: merged maticijus/sec-lane-a into main (c1ec96f, 317 tests green) and pushed main + sec-lane-a over SSH (HTTPS token lacks the workflow scope); pushed maticijus/fix-lane-b (B1-B7 commits, worker not yet done) to origin for safety; submitted the stuck Gemini Cursor review (ctx_4cff95f2a062, released) and committed its three licence findings on main as f867e61 (expiry re-check, Object.hasOwn, ed25519 guard; licence tests green, tsc and lint clean). Session 2's fix lane task_95d4fd78f04d duplicates f867e61 and should be stopped or rebased. Fresh clone outside iCloud at ~/dev/hexprocure (the Documents clone keeps losing files to iCloud eviction). Session 1 stops here.
