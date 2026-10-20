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

Priority order is driven by SME and scaleup adoption in the EU, API quality,
and whether an MCP server already exists. The market research pass of
2026-10-20 fills the table below; the structure is fixed.

| Priority | System | Segment | Public API | MCP server today | Pack |
|---|---|---|---|---|---|
| 1 | QuickBooks Online | accounting, SMB global | REST, OAuth2 | to confirm | Community |
| 2 | Xero | accounting, SMB UK/AU/EU | REST, OAuth2 | to confirm | Community |
| 3 | Pohoda (Stormware) | accounting, CZ | mServer XML | none, HexProcure builds | Team |
| 4 | DATEV | accounting, DE | DATEVconnect, partner programme | none, export first | Team |
| 5 | Sage (50, 200, Intacct) | accounting to mid-market | REST per product | to confirm | Team |
| 6 | Microsoft Dynamics 365 Business Central | mid-market, scaleups | OData/REST, Entra OAuth | to confirm | Business |
| 7 | Odoo | mid-market, open source | XML-RPC/JSON-RPC | community servers exist | Business |
| 8 | NetSuite | mid-market, scaleups US/EU | SuiteTalk REST, OAuth2 | to confirm | Business |
| 9 | SAP Business One / S/4HANA Cloud Public | mid-market | Service Layer / OData | to confirm | Business |
| 10 | Exact Online | accounting, NL/BE | REST, OAuth2 | to confirm | Team |

## 4. Build sequence

1. **Prerequisites (from the review):** dispatcher claim step and retry policy, connector fan-out, token scopes and expiry. Without these an MCP connector would inherit double delivery and unscoped tokens.
2. **HexProcure MCP server, read-only tools.** Smallest useful deliverable; demoable with Claude Desktop in a day. Ships in Community.
3. **`McpConnector` plus one target.** QuickBooks Online first, because mappers already exist and the OAuth flow is specced in `qbo-live-spec.md`. Replace the bespoke `qbo-connector.ts` with the generic path once parity is proven.
4. **Write tools on the HexProcure MCP server.** Team tier.
5. **Connector packs.** Team pack (Xero, Pohoda, DATEV export, Sage), then Business pack (Business Central, Odoo, NetSuite, SAP B1), in the order the research confirms.

## 5. Open decisions for the founder

- Confirm the priority order after reading the research; CZ and DE systems (Pohoda, DATEV) matter for HEXENKRAFT's home market but have the weakest APIs.
- Whether to host ERP MCP servers for cloud customers or ship them as containers only.
- Whether to publish the HexProcure MCP server to the MCP registry under the HexProcure or HEXENKRAFT name.
