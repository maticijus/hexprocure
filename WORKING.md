# WORKING — active-session lock for hexprocure

Read this before editing. Claim before you work; release when you stop.
Protocol: ~/.claude/rules/common/parallel-sessions.md

## Active claims
<!-- newest first; empty when the repo is free -->

- **owner:** claude-fable (audit-fix session, npm audit remediation)
  **machine:** local-mac
  **scope:** branch `chore/audit-fix` in orca worktree audit-fix — package.json + package-lock.json only
  **started:** 2026-10-20T19:40:00Z
  **heartbeat:** 2026-10-20T19:40:00Z
  **next:** bump next/eslint-config-next 16.4.2, nodemailer 10, drizzle-kit 0.31.11, npm audit fix; tsc+lint+build+vitest; push branch; release

- **owner:** claude-fable (Orca coordinator session 2, taken over from coordinator session 1 at founder's request 2026-10-20T18:58Z; session 1 may still be open, do not act on run_5f957954e646 from it)
  **machine:** local-mac
  **scope:** main (merged feat/ai-roadmap, maticijus/ai-line-items, maticijus/ee-license); fix lanes in Orca worktrees sec-lane-a and fix-lane-b off main
  **started:** 2026-10-20T16:05:00Z
  **heartbeat:** 2026-10-20T18:58:00Z
  **next:** lane A merged and pushed (c1ec96f, 317 tests green); lane B (money integrity) B1-B3 done in fix-lane-b, B4 running; Cursor review of licence gate done (3 findings), fix lane task_95d4fd78f04d running in ee-license worktree; then merge B and licence fixes, return docs/security-review to main, release lock

## History
<!-- released claims, trimmed periodically -->
