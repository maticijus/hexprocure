# ERP Integration Route via MCP

Written 2026-10-20. Companion to `pricing-tiers.md` and `ai-roadmap.md`.

## 1. Why MCP

HexProcure already has a transactional outbox and a `Connector` interface
(`src/lib/integrations/types.ts`) with CSV, webhook, email and QuickBooks
payload mappers. Each new ERP today means a bespoke connector in this repo.
The Model Context Protocol gives a second path: ERP vendors and communities
ship MCP servers that expose their APIs as typed tools, and HexProcure can
expose itself the same way. Two directions, one protocol.

```text
                     outbox events                    MCP tools
HexProcure ──────────────────────────► ERP MCP server ──────────► ERP API
   ▲                                   (vendor or HexProcure-built)
   │  MCP tools (read/write P2P objects)
   └────────── HexProcure MCP server ◄──────── agents, Claude, Zapier-class tools
```

## 2. Two deliverables

### 2.1 HexProcure MCP server (outbound capability)

A standalone process in `services/mcp/` (TypeScript, official MCP SDK) that
authenticates with a HexProcure API token (`hxp_…`, scoped) and exposes:

| Tool | Tier | Notes |
|---|---|---|
| `list_requisitions`, `get_requisition`, `list_purchase_orders`, `get_purchase_order`, `list_invoices`, `get_invoice`, `get_budget_status`, `spend_summary` | Community (read-only) | thin wrappers over existing `/api/v1` routes |
| `create_requisition`, `submit_requisition`, `record_receipt`, `create_invoice_draft`, `match_invoice` | Team | every write goes through the existing service layer and its validation; the MCP server never touches the database |
| `approve_step`, `approve_invoice` | not exposed | approvals stay human-only, per the AI principles |
| Resources: `hexprocure://po/{id}`, `hexprocure://invoice/{id}` | Team | for agents that want the document, not a tool call |

Security: token scopes land first (security finding on tokens). The server
inherits the role of the token's user, so a REQUESTER token cannot match
invoices. Rate limits apply per token.

### 2.2 ERP connectors as MCP clients (inbound delivery)

The dispatch loop gains one new `Connector` implementation, `McpConnector`,
configured per ERP with: server command or URL, credentials reference, and a
mapping from HexProcure event types to tool calls. Example for `PO_CREATED`
on Business Central: call `create_purchase_order` with the mapped payload,
store the returned ERP id in a generic `erp_sync_map` (generalising
`qbo_sync_map`). Delivery semantics stay as they are: ok, retryable,
non-retryable; the dispatcher fixes from the review (claim step, retry
policy, fan-out) are prerequisites.

Where a vendor ships an official MCP server, use it. Where none exists,
HexProcure ships a small MCP server per ERP in `services/mcp-erp/<name>/`
wrapping that ERP's REST API, so the mapping layer in the app stays
identical across ERPs.

## 3. Target ERPs and priority

Priority order comes from the 2026-10-20 market research pass
(`research/market-2026-10-20.md`): EU SME adoption first, API openness second,
existence of an official MCP server third. No source gave a reliable
SME-segment market share, so regional dominance is the ranking signal.

| Priority | System | Where it dominates | Public API | Official MCP server (2026-10) | Auth | Pack |
|---|---|---|---|---|---|---|
| 1 | Odoo | ES, LU, AT, Benelux; widest EU SME spread | JSON-2 and XML-RPC | none official, community projects only | API key | Business |
| 2 | Microsoft Dynamics 365 Business Central | Nordics, AT, DACH mid-market | OData and API v2 | Microsoft-hosted, public preview since 2026-04 | Entra ID OAuth2 | Business |
| 3 | Xero | UK, ANZ | REST | official `@xeroapi/xero-mcp-server` | OAuth2 | Community |
| 3 | QuickBooks Online | US, UK, global | REST | official from Intuit, local and hosted | OAuth2 | Community |
| 4 | DATEV | Germany (47 % survey share, likely understated) | partner and marketplace APIs, gated | none | OAuth2/OIDC | Team (export first) |
| 5 | Pohoda (Stormware) | CZ, SK (about 34 % of SK SMBs) | mServer XML, no REST | none | none | Team (HexProcure builds) |
| 5 | Money S3, KROS | CZ, SK rivals to Pohoda | varies | none | varies | later |
| 5 | Exact Online | NL, BE | REST | none | OAuth2 | Team |
| 6 | NetSuite | UK and US scaleups | REST plus SuiteQL | official AI Connector Service, needs the MCP Standard Tools SuiteApp | OAuth2 | Business |
| 7 | SAP Business One / S/4HANA Cloud Public | global SME via partners (B1 over 83,000 customers) | Service Layer / OData | none | session login / OAuth2 | Business |
| later | Sage Intacct, Fortnox (SE), Visma e-conomic (DK), Cegid and Pennylane (FR), AFAS (NL) | regional leaders | varies | none found | varies | by demand |

Two consequences for the design in section 2. First, Xero, QuickBooks,
Business Central and NetSuite already ship official MCP servers, so the
`McpConnector` path in 2.2 is the right shape for them. Second, Odoo, DATEV,
Pohoda and Exact have none, so HexProcure's own thin MCP servers per ERP (or,
for DATEV and the long tail, CSV, UBL and Peppol export) carry those. The
research pass also recommends leading with HexProcure's own MCP server
(2.1) rather than per-ERP clients; both are kept, 2.1 first.

## 4. Build sequence

1. **Prerequisites (from the review):** dispatcher claim step and retry policy, connector fan-out, token scopes and expiry. Without these an MCP connector would inherit double delivery and unscoped tokens.
2. **HexProcure MCP server, read-only tools.** Smallest useful deliverable; demoable with Claude Desktop in a day. Ships in Community.
3. **`McpConnector` plus one target.** QuickBooks Online first, because mappers already exist, the OAuth flow is specced in `qbo-live-spec.md`, and Intuit ships an official MCP server. Replace the bespoke `qbo-connector.ts` with the generic path once parity is proven.
4. **Write tools on the HexProcure MCP server.** Team tier.
5. **Connector packs.** Xero next (official MCP server, same OAuth2 shape as QBO), then Odoo and Business Central as the first Business pack targets, then DATEV export, Pohoda and Exact for the home markets, then NetSuite and SAP B1.

## 5. Open decisions for the founder

- Confirm the priority order. Research puts Odoo and Business Central ahead of QBO and Xero on EU SME adoption; the build sequence still starts with QBO because its mappers exist. CZ and DE systems (Pohoda, DATEV) matter for the home market but have the weakest APIs.
- Whether to host ERP MCP servers for cloud customers or ship them as containers only.
- Whether to publish the HexProcure MCP server to the MCP registry under the HexProcure or HEXENKRAFT name.
