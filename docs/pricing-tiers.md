# HexProcure Pricing and Tiers (proposal)

Written 2026-10-20. Companion to `ai-roadmap.md` and `erp-integration-route.md`.
Target customer: 10 to 250 employees, SME and scaleup. Not enterprise. Everything
below is a proposal for the founder to confirm; market benchmarks are in section 5.

## 1. Principles

1. **Free is real.** The free tier is the full vanilla procure-to-pay loop, self-hosted, MIT licensed, no seat cap. It is the open-source product and the marketing engine. Nothing in the core loop is ever moved behind a paywall.
2. **Pay for AI, connectivity and operations.** The paid tiers add the AI lanes from `ai-roadmap.md`, the ERP connectors from `erp-integration-route.md`, and hosted operation. Those are the parts with real marginal cost (LLM tokens, connector maintenance, hosting, support).
3. **Flat per-company pricing, not per seat.** SMEs hate seat counting and it punishes adoption by requesters. Tiers scale by document volume and connectors instead.
4. **One codebase, feature flags.** Paid features ship in the same repository behind a licence key check in `lib/`, never as a fork. Open-core, not dual repo.
5. **Price for the SME floor.** The brief fixes the current floor at Precoro at roughly 499 USD per month. HexProcure's paid floor should sit well under that.

## 2. The three tiers

| | Community (free) | Team | Business |
|---|---|---|---|
| Price | 0 | about 99 EUR per month, or 990 per year | about 299 EUR per month, or 2,990 per year |
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
| ERP connectors (MCP) | QuickBooks Online, Xero: community maintained | Team pack: QBO, Xero, Sage, Pohoda, DATEV export | Business pack: Team pack plus Business Central, NetSuite, Odoo, SAP Business One |
| HexProcure MCP server (expose HexProcure to agents) | read-only tools | read and write tools | read and write plus webhooks for agent workflows |
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

- Exact price points. 99 and 299 EUR are anchors chosen to sit under Precoro and above tooling like Zahara or ProcurementExpress; confirm after reading section 5.
- Annual-only or monthly too. Recommendation: both, annual at 10 months.
- Whether the Community tier gets a HexProcure cloud "starter" at cost, or stays self-hosted only.
- Licence mechanics: decided 2026-10-20, offline signed key (Ed25519 JWS), see `open-source-gtm.md` section 4.
- Branding and whether this belongs under HEXENKRAFT.

## 5. Market benchmarks

From `research/market-2026-10-20.md` (third-party figures, verify before quoting).

Prices as researched on 2026-10-20; verify before quoting.

| Product | Entry price | Model | Free tier | Where AI sits |
|---|---|---|---|---|
| Ramp | free; Plus 15 USD per user per month plus platform fee | per user | yes | OCR free; AI approvals in Plus; procurement is an add-on |
| Pleo | 4 to 249 EUR per month base, plus 5 to 15 EUR per extra user | base plus users | trial | not stated |
| Payhawk | from 149 EUR per month (small-company programme, no procurement) | modular quote | no | not stated |
| Spendesk | quote; example 299 EUR per month at 100 transactions | flat plus usage | no | not stated |
| Precoro | 35 USD per user or 499 to 999 USD flat, sources conflict | unclear | no | not found |
| Procurify | about 1,000 USD per month, quote | per user, annual | no | not found |
| Tradogram | 99 USD per month plus per-user fees | base plus users | single-user free | not found |
| ProcurementExpress | 30 USD per user per month | per user | not found | not found |
| Odoo Purchase | 17 to 61 USD per user per month | per user | one app free | not found |
| Kissflow, Order.co | quote only | quote | no | not found |

What this says about the proposal in section 2:

- **99 and 299 EUR flat per company undercut every dedicated P2P tool** (Precoro, Procurify, Kissflow) and match the spend-card players (Pleo Advanced 99, Pleo Business 249, Payhawk 149) on price while offering a full P2P loop they do not. Keep the anchors.
- **Per-user pricing is the norm; flat is the differentiator.** A 30-person company on Odoo Purchase pays 500 to 1,800 USD per month; on Precoro per-user, over 1,000 USD. Flat 99 or 299 EUR is a clear story.
- **OCR must stay free.** Ramp gives invoice OCR away. HexProcure already does (self-hosted sidecar). Section 2 keeps OCR and matching in Community; only the LLM lanes move up.
- **No competitor publishes AI gating.** Naming the AI features per tier is a differentiator in itself.
- **No open-source dedicated P2P exists.** Odoo Community and ERPNext are general ERPs. HexProcure is alone in its niche; the open-core model (ERPNext style: hosting plus services, no closed edition) is the closest precedent, and the proposal here adds paid feature packs on top.
