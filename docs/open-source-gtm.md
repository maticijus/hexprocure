# Open-source GTM and repository layout

Written 2026-10-20. Companion to `pricing-tiers.md`. The question: the repo is
already public under MIT, the free tier is the GTM engine, and the paid tiers
need a paywall. Where does paid code live?

## 1. Recommendation: one public repo, open-core with an `ee/` directory

Keep a single public repository. Core stays MIT. Paid code lives in the same
repo under `ee/` with a separate source-available licence and a runtime
licence-key check. Only secrets and cloud plumbing go to a private repo.

```text
hexprocure/                      public
  LICENSE                        MIT, applies to everything outside ee/
  src/, services/, drizzle/      Community tier: full P2P loop, OCR, CSV, webhooks,
                                 email, BYOK lane 1, QBO connector (exists today).
                                 Planned, not in the repo: Xero connector,
                                 read-only MCP server
  ee/
    LICENSE                      HexProcure Commercial Licence (source-available:
                                 read, modify, contribute; production use needs a key)
                                 (draft for legal review)
    README.md, features.ts       exist today: feature id to tier map, not yet used to
                                 gate anything
    ai/                          planned: lanes 2 to 7
    connectors/                  planned: Team and Business connector packs, McpConnector
    mcp-write/                   planned: write tools for the HexProcure MCP server
    sso/, audit-export/          planned
  src/lib/license.ts             verifies a signed licence (Ed25519; the public key is
                                 read from HEXPROCURE_LICENSE_PUBLIC_KEY); returns the
                                 tier and limits

hexprocure-cloud/                private
  licence issuer (private key), billing (Stripe), tenant provisioning,
  EU hosting infra, support tooling
```

This is the PostHog and Cal.com shape (MIT or AGPL core plus `ee/`), and it is
how Twenty and Plane ship too. One CI, one pull-request flow, contributors see
the whole product, and the paid code is still readable, which SME buyers and
security reviewers like.

## 2. Why not private repos for the paid tiers

- Two repos means two CI pipelines, cross-repo version pinning, and paid
  features that cannot be built or tested by contributors. Every refactor of a
  core interface breaks the private side silently.
- The paywall is enforced by the licence key and the cloud, not by hiding
  source. An SME finance team does not fork a repo to strip a licence check;
  the ones who would were never going to pay.
- Private packages still leak through the Docker image. Source-available with a
  clear licence is more honest and just as enforceable.
- What genuinely must stay private is small: the signing key, billing, infra.
  That fits one private repo.

## 3. Licence choices

- **Core: keep MIT.** Changing to AGPL later is possible (all commits are the
  founder's so far) but AGPL scares exactly the SME IT people we want to
  self-host, and no hosting competitor is going to clone an SME P2P tool.
- **`ee/`: HexProcure Commercial Licence**, modelled on the PostHog or Cal.com
  enterprise licence text: source visible, modification and contribution
  allowed, production use requires a valid key, no removal of the key check.
- **Trademark:** register or at least assert "HexProcure" in `TRADEMARK.md` (not
  yet in the repo) so forks cannot ship under the name.
- **Contributions:** a lightweight CLA or DCO sign-off so `ee/` contributions
  can be relicensed. DCO is enough.

## 4. Licence mechanics

- `src/lib/license.ts` verifies a signed JWT (Ed25519) offline, reads
  `tier`, `expiresAt`, `aiDocsPerMonth`, `connectors[]`. Public key in the
  `HEXPROCURE_LICENSE_PUBLIC_KEY` env var (not committed), private key only in
  `hexprocure-cloud`. `scripts/license-sign.ts` signs test tokens.
- `HEXPROCURE_LICENSE` env var carries the token. Absent or invalid means
  Community: the app runs and nothing crashes. Planned, not built: `ee/` features
  rendering as locked with an upgrade link (no feature is gated yet;
  `isFeatureEnabled` is not called in `src/`).
- Planned, not built: build flag `HEXPROCURE_EDITION=community` to exclude `ee/`
  from the bundle for users who want a pure MIT image. The default image would
  include `ee/` locked.
- Planned: usage counters (AI documents) in the existing `llm_usage` table (it
  exists and logs every LLM call), so the cap is enforced where the cost is
  incurred. `aiDocsPerMonth` is parsed from the licence but not enforced.

## 5. Before the repo earns traffic: hygiene

The repo is already public. Scan of the full history on 2026-10-20 found no
credentials (only compose defaults and documentation placeholders). Two items
must be handled before any launch post:

1. **Do not merge `docs/review-2026-10-20.md` to `main` until the CRITICAL and
   HIGH security fixes land.** It documents working exploits
   (register as ADMIN, SQL injection in analytics). Keep it on the feature
   branch or in the private repo until then, then publish it as a fixed
   changelog entry.
2. **`SECURITY.md`** exists (the disclosure address in it is a placeholder the
   founder must confirm). Fix the two CRITICAL findings in the same release.

## 6. Content that makes the free story work

In priority order, each a small pull request:

1. **README rewrite**: one paragraph on who this is for (10 to 250 people, no
   procurement system yet), a 90-second GIF of requisition to matched invoice,
   `docker compose up` quickstart, feature table by tier linking to pricing,
   and the AI principles (drafts never actions) as a trust signal.
2. **`docs/` as a docs site** (Nextra or Docusaurus from the existing Markdown:
   functional spec, API contract, deployment, roadmap). The functional spec
   written today is already the user manual.
3. **Community files**: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
   issue and PR templates under `.github/`, labels `good first issue` on the
   MEDIUM and LOW review items, and GitHub Discussions turned on.
4. **Public roadmap** as a GitHub Project board fed by `ai-roadmap.md` and
   `erp-integration-route.md`; paid items marked with their tier so nobody is
   surprised.
5. **Demo instance** with seeded data and a reset cron, linked from the README,
   running on the same image customers get.
6. **Launch posts**: Show HN, r/selfhosted, r/procurement, Product Hunt,
   the awesome-selfhosted list (requires a release tag and a licence badge),
   and the MCP registry entry for the read-only server.
7. **Comparison pages** in the docs: HexProcure versus Precoro, Procurify,
   Odoo Purchase, using the benchmarks in `research/market-2026-10-20.md`.

## 7. Decisions

- **Decided 2026-10-20 by the founder:** core stays MIT; proceed with the `ee/` layout and licence gate. Build lane dispatched the same day (branch `ee-license`). Landed so far: `src/lib/license.ts`, `GET /api/v1/license`, `ee/LICENSE` (draft), `ee/features.ts`. No paid feature code exists and nothing is gated.

Still open:

- `ee/` licence text: `ee/LICENSE` is a draft for legal review; adapt PostHog's or Cal.com's, or have counsel draft the final one.
- Name of the private repo and whether it sits under HEXENKRAFT's GitHub org.
- DCO versus CLA for contributions (`CONTRIBUTING.md` currently requires a DCO sign-off).
