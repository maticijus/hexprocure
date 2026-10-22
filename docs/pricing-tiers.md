# HexProcure Pricing and Tiers (proposal)

Written 2026-10-20. Companion to `ai-roadmap.md` and `erp-integration-route.md`.
Target customer: 10 to 250 employees, SME and scaleup. Not enterprise. Everything
below is a proposal for the founder to confirm; market benchmarks are in section 5.

## 1. Principles

1. **Free is real.** The free tier is the full vanilla procure-to-pay loop, self-hosted, MIT licensed, no seat cap. It is the open-source product and the marketing engine. Nothing in the core loop is ever moved behind a paywall.
2. **Pay for AI, connectivity and operations.** The paid tiers add the AI lanes from `ai-roadmap.md`, the ERP connectors from `erp-integration-route.md`, and hosted operation. Those are the parts with real marginal cost (LLM tokens, connector maintenance, hosting, support).
3. **Flat per-company pricing, not per seat.** SMEs hate seat counting and it punishes adoption by requesters. Tiers scale by document volume and connectors instead.
4. **One codebase, feature flags.** Paid features ship in the same repository behind a licence key check in `lib/`, never as a fork. Open-core, not dual repo.
5. **Price for the SME floor.** Dedicated P2P tools with a published flat price start at Tradogram Essentials (99 USD per month base plus per-user fees), Zahara Teams (159 GBP per month for 10 users) and ProcurementExpress Basic (415 USD per month); Precoro Core starts at 499 USD per month billed annually. HexProcure prices each paid tier just under its nearest flat-rate comparable, with no per-user fee, so the gap widens with every user.

## 2. The three tiers

| | Community (free) | Team | Business |
|---|---|---|---|
| Price | 0 | 79 EUR per month, or 790 per year | 249 EUR per month, or 2,490 per year |
| Hosting | self-hosted | self-hosted or HexProcure cloud (EU region) | self-hosted or cloud, plus staging environment |
| Users | unlimited | unlimited | unlimited |
| Documents per month | unlimited | 500 invoices through AI extraction | 2,500 invoices through AI extraction, then metered |
| Core P2P loop (requisition, approval bands, PO, receipt, 2/3-way match, budgets, audit) | yes | yes | yes |
| PO PDF and email, attachments, recurring orders, spend analytics | yes | yes | yes |
| CSV export and signed webhooks | yes | yes | yes |
| OCR intake (self-hosted sidecar), regex header extraction | yes | yes | yes |
| AI lane 1: LLM line-item extraction | bring your own key, no support | included, HexProcure key or BYOK | included |
| AI lane 2: exception triage copilot | no | included | included |
| AI lane 3: requisition drafting from text | no | no | included |
| AI lane 4: spend categorisation | no | no | included |
| AI lane 5: duplicate detection | no | included | included |
| AI lane 6: supplier screening (VIES, GLEIF, OpenSanctions) | no | VAT validation only | full screening with evidence PDFs |
| AI lane 7: anomaly flags for approvers | no | no | included |
| ERP connectors | built: CSV export, email, signed webhooks, QuickBooks Online (self-configured) | built: the same four, with HexProcure support; planned: Xero, Sage, Pohoda, DATEV export | planned: Team pack plus Business Central, NetSuite, Odoo, SAP Business One |
| HexProcure MCP server (planned, see `erp-integration-route.md`; no code yet) | read-only tools | read and write tools | read and write plus webhooks for agent workflows |
| Multi-currency display | no | yes | yes |
| SSO (OIDC) | no | no | yes |
| Session revocation, token scopes and expiry | basic | yes | yes |
| Support | community | email, 2 business days | priority, 1 business day, onboarding call |
| Data residency | your server | EU cloud | EU cloud, DPA, audit log export |

Add-ons for either paid tier: extra AI documents in blocks of 1,000 per month; additional ERP connector outside the pack; self-hosted LLM support (Ollama or vLLM) as a one-time setup fee.

## 3. Why these lines

- **Lane 1 on Community with BYOK.** Open-source users get the capability, pay Anthropic directly, and get no support. Team users get it on HexProcure's key with usage included. This keeps the open-source story honest while making Team the obvious step for anyone processing real volume.
- **Lane 2 and 5 on Team, 3, 4 and 7 on Business.** Triage and duplicate detection are finance-desk features every SME wants on day one. Drafting, categorisation and anomaly flags need history and a category tree, so they pay off for larger teams.
- **Connectors are the tier driver, not seats.** Accounting-grade systems (QBO, Xero, Sage, Pohoda, DATEV) sit in Team because that is what a 10 to 50 person company runs. Mid-market ERPs (Business Central, NetSuite, Odoo, SAP B1) are where scaleups land, and they pay Business.
- **Cloud hosting is a tier feature, not a separate product.** It removes the self-hosting objection for buyers without IT.

## 4. Open questions for the founder

- Price points as of 2026-10-22: Team 79 EUR undercuts Tradogram Essentials (99 USD base, per-user fees on top) and Zahara Teams (159 GBP, 10 users); Business 249 EUR undercuts Zahara Business (289 GBP, 18 users) and ProcurementExpress Basic (415 USD), and is half of Precoro Core (499 USD billed annually). Revisit when any of those vendor pages change.
- Annual-only or monthly too. Recommendation: both, annual at 10 months.
- Whether the Community tier gets a HexProcure cloud "starter" at cost, or stays self-hosted only.
- Licence mechanics: decided 2026-10-20, offline signed key (Ed25519 JWS), see `open-source-gtm.md` section 4.
- Branding and whether this belongs under HEXENKRAFT.

## 5. Market benchmarks

Prices read from the vendors' own pricing pages on 2026-10-22; verify before quoting.

| Product | Published price | Model | Source |
|---|---|---|---|
| Precoro | Core from 499 USD per month, Automation from 999 USD per month, both billed annually; Enterprise custom | flat, tier-based user bands | https://precoro.com/pricing/ |
| Tradogram | Essentials 99 USD per month (950.40 per year), per-user fee on top; Premium and Scale by quote | base plus users | https://www.tradogram.com/pricing |
| Zahara | Teams 159 GBP per month (10 users, 120 orders, 250 invoices); Business 289 GBP (18 users); Enterprise 499 GBP (35+ users); excludes VAT | flat with user and document caps | https://www.zaharasoftware.com/pricing |
| ProcurementExpress | Basic 415 USD per month (up to 10k USD managed spend); Better 900; Best 2,550 | flat by managed spend | https://www.procurementexpress.com/pricing/ |
| Spendwise | Basic 9 USD per user per month (1 to 5 users, 10 transactions); Pro 19 USD per user (5 to 50 users, unlimited) | per user | https://www.spendwise.com/pricing |
| Procurify | no public rate card; quote built on Pro users, products and add-ons; unlimited Basic users | quote only | https://www.procurify.com/pricing/ |
| Kissflow | no public rate card; fixed annual agreements, no AI or API surcharges | quote only | https://kissflow.com/pricing/ |
| Order.co | no public rate card | quote only | vendor site |

Spend-card players (Ramp, Pleo, Payhawk, Spendesk) and Odoo Purchase were last checked on 2026-10-20 in `research/market-2026-10-20.md`; they are not dedicated P2P tools and are left out of the anchor.

What this says about the proposal in section 2:

- **79 and 249 EUR flat per company sit just under the cheapest published flat-rate P2P tools** (Tradogram, Zahara, ProcurementExpress) and far under Precoro, while matching the spend-card players (Pleo, Payhawk) on price with a full P2P loop they do not have. Keep the anchors.
- **Per-user pricing is the norm; flat is the differentiator.** A 30-person company on Odoo Purchase pays 500 to 1,800 USD per month; on Tradogram the base plus 30 user fees. Flat 79 or 249 EUR with no seat count is a clear story.
- **OCR must stay free.** Ramp gives invoice OCR away. HexProcure already does (self-hosted sidecar). Section 2 keeps OCR and matching in Community; only the LLM lanes move up.
- **No competitor publishes AI gating.** Naming the AI features per tier is a differentiator in itself.
- **No open-source dedicated P2P exists.** Odoo Community and ERPNext are general ERPs. HexProcure is alone in its niche; the open-core model (ERPNext style: hosting plus services, no closed edition) is the closest precedent, and the proposal here adds paid feature packs on top.
