# §6 Spec: QuickBooks Online Live Integration (OAuth + Sync)

Status: BUILT (see §12) · Prerequisite listed in §10 · Part of MVP2 roadmap

## 1. Goal

Turn the existing offline QBO **payload mappers** (`src/lib/integrations/qbo.ts`) into a
live, authenticated sync: approved invoices and created POs flow into a customer's
QuickBooks Online company automatically, with tokens stored safely and zero token
material ever appearing in logs, audits, or the repo.

**Non-goals:** reading data back from QBO (v2), Xero (the provider abstraction keeps
the door open), historical back-sync of records created before connection.

## 2. Architecture

```
Admin clicks "Connect QBO"
  → GET /api/v1/integrations/qbo/connect        (302 to Intuit authorize URL,
                                                  signed state cookie, PKCE)
Intuit redirects back
  → GET /api/v1/integrations/qbo/callback       (state verified, code exchanged,
                                                  tokens encrypted at rest)
Outbox events accumulate as today
  → POST /api/v1/integrations/dispatch          (QBO connector consumes events:
                                                  decrypt token, refresh if stale,
                                                  call QBO v3 API with realmId)
```

Provider abstraction: `QboConnectionProvider` interface returns a valid access
token for the single active connection. A future `XeroConnectionProvider` plugs
into the same dispatch loop.

## 3. Data model

```sql
CREATE TABLE integrations_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,                       -- 'qbo' | future providers
  realm_id text NOT NULL,                       -- QBO company id
  access_token_enc text NOT NULL,               -- v1:<nonce_b64>:<ciphertext+tag_b64>
  refresh_token_enc text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,      -- QBO: 100 days after issuance
  status text NOT NULL DEFAULT 'ACTIVE',        -- ACTIVE | EXPIRED | REVOKED | ERROR
  last_error text,
  connected_by_user_id uuid REFERENCES users(id),
  created_at / updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qbo_sync_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES integration_events(id),
  entity_type text NOT NULL,                    -- 'PO' | 'BILL'
  local_entity_id uuid NOT NULL,
  qbo_entity_id text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
```

`qbo_sync_map` gives idempotency: dispatch skips an event whose (entity_type,
local_entity_id) is already mapped, so re-running dispatch never duplicates
documents inside QBO.

**Encryption design.**
- Key source: `INTEGRATION_ENC_KEY` env var (base64, 32 bytes; `openssl rand -base64 32`).
  Deliberately **separate from `AUTH_SESSION_SECRET`**: session compromise must not
  yield token-decryption capability.
- Cipher: AES-256-GCM, random 12-byte nonce stored alongside, auth tag appended.
- Envelope: `v1:<nonce_b64>:<ciphertext+tag_b64>` stored in the text columns.
- Rotation: `INTEGRATION_ENC_KEY_PREVIOUS` optional; reads try current then previous;
  writes always use current. Re-encrypt lazily on next token refresh.
- Tokens are **never** logged, never placed in audit payloads, never returned by any
  API response. Status endpoints expose booleans/dates only.

## 4. OAuth flow (Intuit specifics)

| Element | Value |
|---|---|
| Authorize URL | `https://appcenter.intuit.com/connect/oauth2` |
| Scopes | `com.intuit.quickbooks.accounting` |
| Token URL | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` |
| Redirect URI | `INTEGRATION_REDIRECT_URI` env; registered in the Intuit app (localhost allowed for sandbox) |
| CSRF | `state` = HMAC-signed random value in a short-lived (10 min) HttpOnly cookie; verified + consumed on callback |
| Realm selection | `realmId` arrives as query param on callback (user picks company on Intuit's consent screen) |

Flow details:
- `GET …/connect`: ADMIN only. Generates state, sets cookie, 302s to Intuit.
- `GET …/callback`: verifies state cookie, exchanges `code` (+ client credentials
  from `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET`) for token set, encrypts, upserts the
  single active `qbo` connection, renders a tiny "connected ✓" page.
- `POST …/disconnect`: ADMIN only. Marks status `REVOKED`, deletes ciphertext
  immediately (revocation call to Intuit best-effort).

## 5. Token lifecycle

1. Before every API call: if `access_expires_at - now() < 5 min` → refresh.
2. Refresh is **rotating**: the response contains a NEW refresh token; both tokens
   are re-encrypted and persisted in one transaction together with the new expiry.
3. QBO refresh tokens die after ~100 days of non-use → a cron-friendly
   `GET /api/v1/integrations/qbo/status` surfaces `refreshExpiresAt`; the dispatch
   loop marks the connection `EXPIRED` on refresh failure and emits an
   `INTEGRATION_ERROR` notification event (email connector already handles delivery)
   telling an admin to reconnect.
4. Any 401/403 from the QBO API after a successful refresh marks `REVOKED`.

## 6. Sync engine

The existing dispatch loop gains a `QboConnector` (registered only when a healthy
connection exists):

1. Consume event → skip if `qbo_sync_map` already has its event.
2. Resolve the QBO Vendor Id for the event's `supplierId`: vendors are matched by
   DisplayName or created, and cached in `qbo_sync_map` (entity_type `VENDOR`, null
   `event_id`). Then map the payload via the existing mappers
   (`poEventToQboPurchaseOrder`, `invoiceEventToQboBill`), passing the vendor id.
3. `POST https://{sandbox-?}.api.intuit.com/v3/company/{realmId}/purchaseorder|bill`
   with `Authorization: Bearer <access>` and `Content-Type: application/json`.
4. On success: insert `qbo_sync_map` row (idempotency), event → DELIVERED.
5. On 4xx: FAILED, non-retryable, lastError preserved (payload problem: human fix).
   On 5xx/network: retryable (existing semantics).
6. Connection missing/unhealthy → events stay PENDING (current behavior).

## 7. Configuration surface

```bash
# .env.example additions
QBO_CLIENT_ID=
QBO_CLIENT_SECRET=
QBO_SANDBOX=true                      # sandbox vs live API host
INTEGRATION_REDIRECT_URI=http://localhost:3000/api/v1/integrations/qbo/callback
INTEGRATION_ENC_KEY=                  # openssl rand -base64 32
# INTEGRATION_ENC_KEY_PREVIOUS=       # during rotation only
```

## 8. Testing strategy

- Unit: envelope encrypt/decrypt round-trip, wrong-key rejection, tamper rejection;
  refresh decision boundary (< 5 min); state cookie verify/consume/expiry.
- Integration: full connect→dispatch against a **stubbed Intuit HTTP layer**
  (injected fetch, same pattern as webhook/OCR tests): happy path, rotating refresh,
  401→REVOKED, idempotent double-dispatch.
- Contract smoke (manual, gated): with real sandbox credentials,
  `SKIP_QBO_LIVE !== true npm run test:qbo-live` exercises sandbox end-to-end.

## 9. Acceptance criteria

1. Connect flow completes on sandbox; `integrations_connections` holds only
   ciphertext (verified by test querying raw column values).
2. Dispatch pushes a PO into sandbox QBO exactly once; second dispatch is a no-op.
3. Access-token refresh occurs within the 5-minute window and rotates the stored
   refresh token (observable via updated `updated_at` + changed ciphertext).
4. Revoked/expired connection leaves outbox events PENDING and notifies FINANCE/ADMIN.
5. No test, log line, or audit row ever contains a plaintext token (grep-enforced test).
6. Disconnect wipes ciphertext in the same request.

## 10. Prerequisites: what is actually blocked

| Need | Blocked on |
|---|---|
| Sandbox development (unit + stubbed integration) | **Nothing: buildable now** |
| Live contract test | Intuit developer account → app → `CLIENT_ID/SECRET` (free) |
| Production OAuth | Public HTTPS redirect URI (deployed host) |

Everything except step two of the contract smoke can be built and merged without
external access.

## 11. Estimate

~5 working days: crypto module ½d · connection store + OAuth routes 1d ·
lifecycle/refresh 1d · QboConnector + idempotency 1d · tests/docs 1–1.5d.

## 12. Acceptance status (2026-10-21)

| # | Criterion | Proof | Status |
|---|---|---|---|
| 1 | Connect stores only ciphertext in raw columns | `qbo-connection.test.ts`: "stores only ciphertext" (raw `select` of both `*_enc` columns, `v1:` prefix, no plaintext) | PASS |
| 2 | PO pushed once, second dispatch a no-op | Stubbed: `qbo-connector.test.ts`: "records a sync-map row so a second delivery is skipped". Real sandbox: `tests/live/qbo-live.test.ts` | PARTIAL (live smoke needs credentials) |
| 3 | Refresh in the 5-minute window rotates the refresh token | `qbo-connection.test.ts`: "refreshes when the access token expires within 5 minutes and rotates both tokens" (ciphertext changed, decrypts to the new refresh token, `updated_at` advanced) | PASS |
| 4 | Revoked/expired leaves events PENDING and notifies FINANCE/ADMIN | `qbo-connector.test.ts`: "leaves the event PENDING and makes no API call when the connection is not healthy" (through `dispatchPendingEvents`); `qbo-connection.test.ts`: "connection problem notifications" (4 tests); `email.test.ts`: "renders an integration error" | PASS (was MISSING; the connector used to return `ok:true`, so the dispatcher marked such events DELIVERED) |
| 5 | No plaintext token in logs, audit rows or test output | `qbo-secrets.test.ts`: static scan of every QBO source file plus a runtime sentinel run over console, `audit_events`, `integration_events`, `last_error` | PASS |
| 6 | Disconnect wipes ciphertext in the same request | `api/v1/integrations/qbo/disconnect/route.test.ts`: "wipes both stored tokens in the same request"; "rejects non-admin callers" | PASS |

Wipe semantics: the token columns are `NOT NULL`, so disconnect overwrites both with
a fresh envelope of the literal `revoked` instead of nulling them.

Also fixed: dispatch now orders the batch by fewest attempts first, so events stuck behind a down connector cannot starve fresh ones such as the reconnect notification; an expired refresh token (past `refresh_expires_at`) now marks the
connection `EXPIRED` and notifies once, instead of failing on every dispatch.

### Live contract smoke (criterion 2, real sandbox)

Not part of `npm test` or `npx vitest run`. One command, run once credentials exist:

```bash
QBO_CLIENT_ID=... QBO_CLIENT_SECRET=... QBO_SANDBOX=true \
INTEGRATION_ENC_KEY="$(openssl rand -base64 32)" \
QBO_LIVE_REALM_ID=<sandbox company id> QBO_LIVE_REFRESH_TOKEN=<sandbox refresh token> \
npm run test:qbo-live
```

Optional: `QBO_LIVE_VENDOR_ID` (defaults to `1`). Obtain the realm id and refresh token
from the Intuit developer account (app keys, then the OAuth 2.0 Playground against
the sandbox company). It runs against the `hexprocure_test` database from `.env.test`
and refuses to run with `QBO_SANDBOX=false`. A missing variable fails the run; it is
never skipped.

Known risk for the first live run: the PO mapper emits `VendorRef` as
`{ "value": <supplier>, "name": <supplier> }` (`src/lib/integrations/qbo.ts`), where
`<supplier>` is the HexProcure supplier name from the event payload
(`src/lib/services/p2p/purchase-orders.ts`), while the QBO API expects the vendor id
in `value`. The stubbed tests cannot see this; the first live run is expected to
confirm or correct it.

