# MVP2 Spec — Daily-Usage Blockers & Scope Boundary

Status: §1–§5 SHIPPED · §6 specced separately in [qbo-live-spec.md](qbo-live-spec.md) · Derived from the product-critical review of v1 (2026-08-24)
Goal: turn HexProcure from *pilot-able* into *habit-forming* for the target SME
(20–100 employees, indirect-heavy spend, QuickBooks/Xero/Lexware accounting).

## Scope boundary (reaffirmed)

**In:** indirect goods & fixed-price services. **Out:** direct/materials procurement
(no inventory/MRP context by design), time-&-materials services until §4 ships,
payments execution (we stop at the approved, matched invoice).

---

## 1. Email notifications — P0, the loop-closer

**Problem.** Approvals exist only in the inbox page. Approvers don't check it;
requests stall silently; users churn within a week.

**Design.**
Reuse the transactional outbox — do **not** build a second queue.

- New integration event types: `APPROVAL_REQUESTED`, `REQUISITION_DECIDED`,
  `INVOICE_EXCEPTION`.
- Emitted inside the same transactions that change state (`submitRequisition`,
  `decideApproval`, `matchInvoiceById`) with recipient role/entity in payload.
- New `EmailConnector` implementing the existing `Connector` interface:
  SMTP via env (`SMTP_URL`, `SMTP_FROM`), one templated email per event type.
  Template = plain-text + minimal HTML, stored as TS constants (no template engine).
- Dispatch loop is unchanged — notifications are just another connector.
- Dev/test story: SMTP_URL unset ⇒ connector logs instead of sending; unit tests
  inject a fake transport (same pattern as webhook's injected `fetch`).

**API/UI touchpoints.** None new. Settings page (P2) exposes per-role routing later.

**Acceptance criteria.**
1. Submitting a requisition enqueues exactly one event per required approver step.
2. Approve/reject enqueues one event to the requester.
3. An EXCEPTION match enqueues to all FINANCE users.
4. Connector failure marks event FAILED with lastError; retry works via dispatch.
5. No email leaves the system when SMTP_URL is unset (log-only mode covered by test).

**Estimate:** 2–3 days (events ½d, connector + templates 1d, tests ½–1d).

---

## 2. PO document: PDF generation + send-to-supplier — P0

**Problem.** You can create a PO but cannot hand it to anyone. Screenshotting your
own procurement system is disqualifying for daily use.

**Design.**

- **PDF rendering:** `@react-pdf/renderer` (pure JS, no headless browser).
  One React-PDF document component: logo placeholder, PO number/date, supplier
  block, lines table, total, cost center, internal reference id footer.
  Route: `GET /api/v1/purchase-orders/:id/pdf` → `application/pdf`
  (auth: any authenticated org member; supplier copy omits internal notes/cost center).
- **Send:** `POST /api/v1/purchase-orders/:id/send` body `{ to?: string }`
  (defaults to supplier email if present). Reuses the §1 mailer adapter.
  Records audit event `PO_SENT` with recipient + timestamp; UI shows "Sent ✓".
- Supplier email lives on `suppliers.email` already; validation: PO must be OPEN.

**Acceptance criteria.**
1. PDF renders identical content across runs for the same PO (golden-file test).
2. Supplier variant excludes cost center and internal reference fields (test).
3. Send requires OPEN status (409 otherwise) and records an audit event (test).
4. Send fails cleanly with 422 when supplier has no email and none provided.

**Estimate:** 3 days (PDF component 1–1.5d, route + send + audit 1d, tests ½d).

---

## 3. Attachments — P1

**Problem.** Quotes on requisitions, signed offers, invoice files. Procurement
without document attachment feels broken and kills audit value.

**Design.**

- Table `attachments`: `id, entity_type ('requisition'|'purchase_order'|'invoice'),
  entity_id, filename, mime_type, size_bytes, storage_key, uploaded_by_user_id,
  created_at`. Polymorphic, no FK cascade — deletion policy follows parent service logic.
- Storage behind a `FileStore` interface: `LocalFileStore` (disk under
  `DATA_DIR/uploads/`, path = uuid) now; `S3FileStore` later without call-site changes.
- Uploads restricted: ≤10 MB, MIME allowlist (pdf/png/jpeg/webp/txt/zip).
- Routes: `POST /api/v1/attachments` (multipart, entityType+entityId),
  `GET /api/v1/attachments/:id` (streamed download), `DELETE` (uploader or ADMIN).
- Virus/malware scanning: out of scope v1, noted in Known Gaps.
- UI: paperclip chip on requisition detail + invoice rows; drag-drop upload.

**Acceptance criteria.**
1. Round-trip upload→download preserves bytes (integration test).
2. Oversized/disallowed MIME returns 400 with field-level message.
3. Download requires authentication; 403 for cross-org (single-tenant v1: any authed user may read — documented).
4. Deleting a requisition soft-deletes nothing: attachments remain orphaned-but-listed under admin tooling (documented behavior v1).

**Estimate:** 2 days backend, 1 day UI.

---

## 4. Services procurement (fixed-price & milestones) — P1, unlocks the services answer

**Problem.** Quantity×price matching breaks down for services. Today users fake it
(`1 × €10,000`), which works but is unprincipled; T&M doesn't fit at all.

**Design (deliberately small).**

- `po_lines.kind`: enum `GOODS | SERVICE` (default GOODS; migration backfill).
- **SERVICE lines skip quantity semantics entirely**: no receipt requirement,
  matching checks **amount only** — cumulative invoiced minor-units against the
  line may not exceed ordered amount (tolerance €0).
- Receipt for SERVICE lines becomes an explicit **acceptance action**
  (`POST …/receipts` accepts `{accepted: true}` without quantities) so the audit
  trail still answers "who accepted the work?".
- Invoice lines referencing SERVICE PO lines carry `amountMinor` instead of qty×price.
- Matching exceptions unchanged otherwise (`PRICE_MISMATCH` n/a; `OVER_INVOICED`
  becomes `OVER_INVOICED_AMOUNT`).
- Milestones = multiple SERVICE lines on one PO ("Phase 1", "Phase 2") — no new
  concept shipped; documented pattern.
- **Explicitly out:** T&M/time sheets, rate cards, service-entry sheets (revisit P3).

**Acceptance criteria.**
1. SERVICE line: invoice exceeding ordered amount → `OVER_INVOICED_AMOUNT` (test).
2. SERVICE line: no receipts exist, full-amount invoice matches clean (test).
3. GOODS lines behave byte-for-byte as before (existing suite green untouched).
4. Mixed PO (goods + service) produces correct combined exceptions (test).

**Estimate:** 2 days domain+service, ½ day migration/backfill, ½ day tests.

---

## 5. Recurring orders / templates — P2

**Problem.** SaaS renewals, rent, retainers: monthly repetition is re-keyed today.

**Design sketch (spec-level, refine before build).** `order_templates` table
(supplier, costCenterId, lines, cadence `MONTHLY|QUARTERLY|YEARLY`, next_run_date);
a scheduler row generates DRAFT requisitions; human submits as usual (no auto-PO).
Sequencing: after §1 (needs the scheduler habit) — defer detailed spec.

**Estimate:** 3–4 days when scheduled.

## 6. Accounting write-back (QBO live) — P2

Current QBO mappers produce payloads; OAuth client + token storage + sync status
UI are missing. Sequenced after §1–§4 because CSV export covers the need at MVP
scale. Requires secret handling design (token encryption at rest) before build.

**Estimate:** 4–5 days incl. sandbox testing.

---

## Sequencing & rationale

```
§1 Notifications ──┐
§2 PO PDF/Send  ───┼──▶ daily-habit threshold reached
§3 Attachments  ───┘
§4 Services kind  ──▶ unlocks the services answer (fixed-price)
§5/§6             ──▶ growth features, post-adoption
```

Total to habit-forming: ~8–9 working days. Total including §5–§6: ~16 days.

## Non-goals (unchanged)

Direct/materials procurement, inventory, sourcing/RFQ, contracts, payments,
multi-currency conversion, mobile apps, supplier portal (v2 candidate).
