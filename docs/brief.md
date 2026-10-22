# HexProcure: Product Brief

## Problem
SMBs (10–50 employees) manage purchasing over email/spreadsheets: no approval control,
no PO trail, invoice mismatches discovered at month-end. Enterprise tools (Coupa, quote only) and
Procurify (quote only, third-party estimates around 1,000 USD per month) are overkill.
Dedicated P2P with a published price starts at Tradogram Essentials (99 USD per month base plus per-user
fees), Zahara Teams (159 GBP per month for 10 users) and Precoro Core (499 USD per month billed annually).
Prices read from vendor pricing pages on 2026-10-22; see `pricing-tiers.md` section 5 before quoting.

## Users
- **Requester** (any employee): raises purchase requests, tracks status
- **Manager**: approves/rejects within limits
- **Finance/AP**: matches invoices, manages suppliers, watches budgets
- **Admin**: configures approval rules and budgets

## Scope (MVP)
Requisition → rule-based approval → PO → goods receipt → invoice capture & 2/3-way match;
monthly budgets per cost center; spend dashboards.

## Explicit non-goals (v1)
- Supplier network / marketplace / punch-out catalogs
- ERP integrations beyond CSV export (QuickBooks/Xero = v2)
- Multi-currency conversion (store currency-aware, convert never)
- Sourcing/RFQ, contracts, PCards, payments execution
- Mobile apps (responsive web only)

## Done means
Happy path E2E green (request→approve→PO→receive→match), 80%+ domain coverage,
lint/type/build clean, security pass on every endpoint.
