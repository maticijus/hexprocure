# §6 Spec — QuickBooks Online Live Integration (OAuth + Sync)

Status: READY TO BUILD · Prerequisite listed in §10 · Part of MVP2 roadmap

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
  access_token_enc bytea NOT NULL,              -- AES-256-GCM ciphertext
  refresh_token_enc bytea NOT NULL,
  token_nonce bytea NOT NULL,                   -- GCM nonce (unique per row write)
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
- Envelope: `enc:v1:<nonce_b64>:<ciphertext+tag_b64>` stored in the bytea columns.
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
2. Map payload via the existing mappers (`poEventToQboPurchaseOrder`,
   `invoiceEventToQboBill`).
3. `POST https://{sandbox-?}.api.intuit.com/v3/company/{realmId}/purchaseorder|bill`
   with `Authorization: Bearer <access>` and `Content-Type: application/json`.
4. On success: insert `qbo_sync_map` row (idempotency), event → DELIVERED.
5. On 4xx: FAILED, non-retryable, lastError preserved (payload problem — human fix).
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
  `SKIP_QBO_LIVE !== true npm run test:contract` exercises sandbox end-to-end.

## 9. Acceptance criteria

1. Connect flow completes on sandbox; `integrations_connections` holds only
   ciphertext (verified by test querying raw column values).
2. Dispatch pushes a PO into sandbox QBO exactly once; second dispatch is a no-op.
3. Access-token refresh occurs within the 5-minute window and rotates the stored
   refresh token (observable via updated `updated_at` + changed ciphertext).
4. Revoked/expired connection leaves outbox events PENDING and notifies FINANCE/ADMIN.
5. No test, log line, or audit row ever contains a plaintext token (grep-enforced test).
6. Disconnect wipes ciphertext in the same request.

## 10. Prerequisites — what is actually blocked

| Need | Blocked on |
|---|---|
| Sandbox development (unit + stubbed integration) | **Nothing — buildable now** |
| Live contract test | Intuit developer account → app → `CLIENT_ID/SECRET` (free) |
| Production OAuth | Public HTTPS redirect URI (deployed host) |

Everything except step two of the contract smoke can be built and merged without
external access.

## 11. Estimate

~5 working days: crypto module ½d · connection store + OAuth routes 1d ·
lifecycle/refresh 1d · QboConnector + idempotency 1d · tests/docs 1–1.5d.
