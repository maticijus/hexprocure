# HexProcure AI Roadmap

Written 2026-10-20. Companion to `functional-spec.md` (what exists) and
`ai-lane-1-line-items.md` (the first build). Ranked by entry friction, lowest
first, the same way `_Strategy/SME-value-plays.md` ranks the supplier-risk plays.

## Principles that every idea must respect

These come from the product as shipped. An idea that breaks one of them is a
different product.

1. **Drafts, never actions.** AI output is a proposal a human confirms. The LLM never approves, orders, pays, or changes a state machine.
2. **Deterministic core stays deterministic.** Matching, budgets, approval routing, money arithmetic stay in `src/domain` with zero AI. AI feeds inputs into them or explains their outputs.
3. **Schema at the boundary.** Every LLM response is validated against a JSON schema and normalized in a pure domain function before anything else touches it. Free text from the model is display-only.
4. **Documents are untrusted input.** Invoice text, supplier emails and attachments can contain injected instructions. Prompts put them in a data role, structured outputs constrain what comes back, and the model is never given a tool that changes state.
5. **Opt-in and provider-agnostic.** No LLM call happens unless the operator configures a provider. The provider sits behind one interface (`LlmProvider`, like `OcrProvider`) so the hosted Claude API and a self-hosted model are interchangeable. The README states plainly which data leaves the box when a hosted provider is on.
6. **Cost is bounded and visible.** Per-call token caps, prompt caching for the stable system prompt, and a usage log row per call so the operator can see spend.

## The ranked list

### 1. Invoice line-item extraction (first lane, specced)
**Pain.** Today extraction returns four header fields; finance retypes every line, which is where the matching value is.
**What.** Given OCR text and the PO's lines, return structured invoice lines (description, quantity, unit price in minor units, suggested `poLineId`, confidence). Human reviews, saves, and the existing 2/3-way match runs.
**Why first.** Pipeline, UI slot, review pattern and audit all exist. Pure additive. One provider interface unlocks every other item below.
**Friction.** Low. Needs one API key.

### 2. Exception triage copilot
**Pain.** `EXCEPTION` invoices show codes (`PRICE_MISMATCH`, `OVER_INVOICED`). Finance still has to work out what happened and what to do.
**What.** For each exception, a one-paragraph plain-language explanation and a suggested resolution from a fixed menu (accept variance within tolerance, request credit note, wait for receipt, split invoice, reject). Inputs are the deterministic exception list, PO, receipts and prior invoices. Output is text plus an enum; the human picks.
**Friction.** Low. Reads existing data, writes nothing.

### 3. Requisition drafting from free text
**Pain.** Requesters do not know supplier IDs, cost centers or unit prices.
**What.** "Three 27-inch monitors for the Brno office" becomes a DRAFT requisition: supplier suggested from past POs with similar lines, cost center from the requester's history, lines with prices copied from the last PO for the same description. Model proposes, deterministic lookups fill IDs, user edits and submits.
**Friction.** Low to medium. Needs a small retrieval step over past PO lines (Postgres full-text or trigram is enough; no vector DB).

### 4. Spend categorisation
**Pain.** Analytics groups by supplier, cost center and month. The API contract promises `category` and it does not exist because nobody categorises lines.
**What.** Classify each PO line description into a fixed category tree (a trimmed UNSPSC level 2 list shipped as a constant). Batch job, cached per normalised description, result stored on `po_lines.category`. Unlocks `groupBy=category`, savings analysis and the risk work below.
**Friction.** Medium. Needs a migration and a backfill job; Message Batches API halves the cost.

### 5. Duplicate and near-duplicate invoice detection
**Pain.** Same invoice arriving twice (email and portal, or resent after a dispute) is the classic SMB double payment.
**What.** Deterministic first: same supplier plus same number is already unique; add same supplier plus same total within 7 days as a warning. LLM second: compare OCR text of a new invoice against candidates and return `duplicate | revision | distinct` with reasoning. Surface as an exception code `POSSIBLE_DUPLICATE` the human clears.
**Friction.** Medium. Mostly deterministic; the LLM step is small.

### 6. Supplier screening and master-data hygiene
**Pain.** From `_Strategy/SME-value-plays.md` plays #2 and #3: SMEs must evidence sanctions screening for banks and auditors, and dirty vendor masters break everything downstream.
**What.** On supplier create and nightly: VIES VAT validation, GLEIF lookup, OpenSanctions fuzzy match. LLM adjudicates ambiguous hits ("is this Müller GmbH our Müller GmbH?") and drafts the audit note; the deterministic part writes a timestamped evidence row. Dedupe suggestions for near-identical supplier names.
**Friction.** Medium. External free APIs, new tables, a scheduler (the dispatch loop already needs one).

### 7. Policy anomaly flags on requisitions
**Pain.** Approval bands are gamed by splitting orders; prices drift up unnoticed; new suppliers appear without review.
**What.** At submit time, deterministic signals (same requester, same supplier, several requisitions just under a band boundary within 14 days; unit price more than 20 % above the trailing median for that description; first order with a supplier). LLM writes the one-line note the approver sees. Nothing blocks; the approver gets context.
**Friction.** Medium. Depends on #4 for good price comparisons.

### 8. Email-in invoice intake
**Pain.** Invoices arrive by email; someone downloads and uploads them.
**What.** IMAP poll of a dedicated mailbox, attachments go through `/invoices/extract`, drafts land in a review queue. The LLM step is #1; this item is plumbing.
**Friction.** Medium. Mail credentials, an inbox state table, and the same scheduler as #6.

### 9. Natural-language analytics
**Pain.** "How much did we spend with Alza last quarter" needs a developer today.
**What.** Question becomes a call to the existing analytics service with validated parameters (not generated SQL). Small, safe, and limited to what the analytics layer already exposes.
**Friction.** Low technically, low value until #4 gives it categories. Keep for later.

### 10. Supplier risk monitoring (play #4 of the strategy doc)
**Pain.** Insolvency, sanction or disaster hits a supplier and the SMB finds out weeks later.
**What.** GDACS disaster alerts geocoded to supplier addresses, news classification into the 43-incident taxonomy in `_Library`, weekly digest. A separate product surface that shares the supplier table and the screening evidence from #6.
**Friction.** High. Entity disambiguation and noise control are real work; do #6 first.

## Sequencing

```text
Lane 1  line-item extraction        (now)      establishes LlmProvider, usage log, review UI pattern
Lane 2  exception triage            (next)     reuses provider, read-only
Lane 3  requisition drafting                   reuses provider, adds retrieval over PO lines
Lane 4  spend categorisation                   migration + batch job; unlocks 7 and 9
Lane 5  duplicate detection                    small
Lane 6  supplier screening                     external APIs, scheduler
Lanes 7-10 after the above
```

## Provider and model

Default provider is the Claude API through `@anthropic-ai/sdk`, model `claude-opus-5-5` (configurable). Structured outputs via `output_config.format` guarantee schema-valid JSON. Adaptive thinking stays on; effort `low` for extraction and classification, `medium` for triage text. Prompt caching on the system prompt and the PO context. A self-hosted provider (OpenAI-compatible endpoint such as Ollama or vLLM) is a second implementation of the same interface for operators who must keep documents in-house; it is not in lane 1.

## Open decisions for the founder

- Hosted Claude API as default (documents leave the server, 30-day retention on Anthropic's side) versus self-hosted only. Recommendation: hosted default, self-hosted later, both behind the same interface.
- Which category tree for #4 (UNSPSC trimmed, or a custom 30-item list).
- Whether HexProcure joins the HEXENKRAFT vault and brand set, or stays a standalone open-source project.
