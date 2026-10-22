# WORKING — active-session lock for hexprocure

Read this before editing. Claim before you work; release when you stop.
Protocol: ~/.claude/rules/common/parallel-sessions.md

## Active claims
<!-- newest first; empty when the repo is free -->

- **owner:** claude-fable (ee-license worktree session, licence closure apply)
  **machine:** local-mac
  **scope:** branch `maticijus/ee-license` — ee/LICENSE, ee/README.md, CONTRIBUTING.md, .env.example, src/lib/license.ts (+test), src/app/api/v1/license (+test), scripts/license-sign.ts, ee/features.test.ts
  **started:** 2026-10-22T07:05:00Z
  **heartbeat:** 2026-10-22T07:05:00Z
  **next:** apply closure-fix-spec (D1 no, D2 no, D3 yes), pin public key, drop token limit fields, route status field, tests, then separate review lane

- **owner:** claude-fable (Orca coordinator session, review + AI roadmap + first build lane)
  **machine:** local-mac
  **scope:** branch `feat/ai-roadmap` — docs/ (review, functional spec, AI roadmap, implementation spec) + first AI lane under src/lib/integrations and src/domain
  **started:** 2026-10-20T16:05:00Z
  **heartbeat:** 2026-10-20T16:05:00Z
  **next:** repo review, functional spec, diagram, AI ideation, implementation spec, dispatch first lane via Orca

## History
<!-- released claims, trimmed periodically -->
- 2026-10-21 claude-fable released `maticijus/ee-license` licence finalisation (6a73f28, after advokát panel, GitHub benchmark, Grok buyer review and two closure checks). Open: Czech advokát review of ee/LICENSE, chain-of-title check.
