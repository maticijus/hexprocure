# HexProcure — Product Brief

## Problem
SMBs (10–50 employees) manage purchasing over email/spreadsheets: no approval control,
no PO trail, invoice mismatches discovered at month-end. Enterprise tools (Coupa ~$2.5k/mo,
Procurify ~$1–2k/mo) are overkill; Precoro ($499/mo) is the current floor for real P2P.

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
