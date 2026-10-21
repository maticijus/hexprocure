# Deployment Guide

Step-by-step production deployment for HexProcure on a single Linux server,
plus the full configuration reference and role model.

Target: Ubuntu 22.04/24.04 · any Debian-family VPS works. Everything also runs
under Docker Compose if you prefer containers (§9).

---

## 1. What runs in production

| Process | Purpose | Required? |
|---|---|---|
| **hexprocure** (Next.js, port 3000) | App + API | yes |
| **PostgreSQL 16** | All data | yes |
| **OCR sidecar** (FastAPI, port 8100) | AI invoice intake | optional |
| **Cron/timers** | `integrations/dispatch` + `order-templates/run` | recommended |
| **nginx + TLS** | Reverse proxy, certificates | recommended |

## 2. Server preparation

```bash
# as root
apt update && apt upgrade -y
apt install -y curl git nginx postgresql postgresql-contrib ufw

# firewall
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable

# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# dedicated app user (no sudo)
adduser --system --group --home /opt/hexprocure hexprocure
```

Create the database:

```bash
sudo -u postgres psql <<'SQL'
CREATE USER hexprocure WITH PASSWORD 'STRONG-PASSWORD-HERE';
CREATE DATABASE hexprocure OWNER hexprocure;
SQL
```

## 3. Application setup

```bash
sudo -u hexprocure -H bash
cd /opt/hexprocure
git clone https://github.com/maticijus/hexprocure.git app && cd app
npm ci
npm run build
```

### 3.1 Configuration: `/opt/hexprocure/app/.env` (chmod 600)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://hexprocure:PASSWORD@localhost:5432/hexprocure` |
| `AUTH_SECRET` | ✅ | Session signing secret. `openssl rand -hex 32`. Rotating it logs everyone out. Min 32 chars, placeholders rejected at startup. |
| `SMTP_URL` | ⚠️ rec. | e.g. `smtp://user:pass@smtp.provider.com:587`. Without it notifications are logged, not sent. |
| `SMTP_FROM` | w/ SMTP | Sender address, e.g. `procurement@yourcompany.com` |
| `ALLOW_SELF_REGISTRATION` | first admin | In production, `POST /api/v1/auth/register` is refused unless this is exactly `true`. Set it for §3.3, then remove it. |
| `TRUST_PROXY` | behind nginx | Set to `true` only behind a proxy that appends the real client IP as the last `X-Forwarded-For` hop (see §6). The proxy headers (`X-Forwarded-For`, then `X-Real-IP`) are read only when this is `true`. Otherwise every client shares one rate-limit bucket. |
| `INTEGRATION_DISPATCH_INTERVAL_MS` | optional | Run the outbox drain inside the app every N ms (see §5.1; the dispatch cron call is then optional). Unset = off. |
| `INTEGRATION_OCR_URL` | optional | OCR sidecar, e.g. `http://localhost:8100`. Unset = invoice intake disabled (501). |
| `DATA_DIR` | optional | Attachment storage root (default `.data/uploads`). Put it OUTSIDE the repo dir if you deploy by re-cloning. |
| `INTEGRATION_CSV_DIR` | optional | Directory the CSV connector appends to: one file per UTC day and event type (`PO_CREATED-2026-10-21.csv`), header written once. Unset = CSV connector off. Compose sets it to the `csvexports` volume. Columns, in order: `event_id`, `record_type`, `reference`, `line_number`, `description`, `quantity`, `unit_price_minor`, `supplier`, `cost_center`, `currency`, `total_minor`, `issued_on`, `invoice_number`, `purchase_order`. Every row carries the outbox `event_id`, so an importer can dedupe a replayed file. Delivery is tracked per connector, so a retry after another connector failed does not append the rows again. |
| `INTEGRATION_WEBHOOK_URL` | optional | Push events to an external endpoint |
| `INTEGRATION_WEBHOOK_SECRET` | optional | HMAC key receivers verify (`X-HexProcure-Signature`) |
| `INTEGRATION_ENC_KEY` | for QuickBooks | AES-256-GCM key for OAuth tokens (`openssl rand -base64 32`) |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | for QuickBooks | Intuit app credentials. `QBO_SANDBOX` defaults to sandbox; set `false` for live. |
| `INTEGRATION_REDIRECT_URI` | for QuickBooks | Must match Intuit app registration |

**Never commit `.env`. It contains session-signing and database secrets.**

### 3.2 Database schema

```bash
node --env-file=.env scripts/migrate.mjs   # applies all migrations in drizzle/
```

The script does not read `.env` itself, so pass it with `--env-file=.env` (or export `DATABASE_URL`). `npx drizzle-kit migrate` exits 1 silently with drizzle-kit 0.31.x, so use the script. Use `npx drizzle-kit generate` only to create new migrations after schema changes.

Do NOT run `scripts/seed.ts` in production. It creates demo accounts with a
public password.

### 3.3 First login & first admin

1. In production, self-registration is off unless `ALLOW_SELF_REGISTRATION=true` is in `.env` (restart the app after setting it). The login page has no registration form, so register through the API; it always creates a `REQUESTER`:

```bash
curl -X POST https://procure.yourcompany.com/api/v1/auth/register \
  -H "content-type: application/json" \
  -H "origin: https://procure.yourcompany.com" \
  -d '{"name":"You","email":"you@yourcompany.com","password":"at-least-8-chars"}'
```

2. Promote yourself from the server:

```bash
sudo -u postgres psql hexprocure \
  -c "UPDATE users SET role='ADMIN' WHERE email='you@yourcompany.com';"
```

   With Docker Compose use `docker compose exec db psql -U hexprocure hexprocure -c "..."` instead. Then log in at `/login`.

3. As ADMIN: configure suppliers, cost centers, budgets and approval rules.
   There is no create or edit UI or API for any of them yet (the suppliers pages are
   read-only), so insert them with SQL.
   Example ruleset:

```sql
INSERT INTO approval_rules (sequence, min_minor, max_minor, approver_role) VALUES
  (1, 0,      50000,   'MANAGER'),
  (2, 50000,  NULL,    'FINANCE');
```

4. Register the other users the same way (new accounts are REQUESTER; promote team
   leads to MANAGER, accounting to FINANCE). Once everyone is registered, remove
   `ALLOW_SELF_REGISTRATION` from `.env` and restart.

## 4. Role model

Assigned via `users.role`. Rows marked "any user" are not role-checked by the API.

| Capability | REQUESTER | MANAGER | FINANCE | ADMIN |
|---|---|---|---|---|
| Create/submit requisitions | ✓ | ✓ | ✓ | ✓ (any user) |
| Approve/reject items whose rule names your role | – | ✓ | ✓ | ✓ (any step) |
| Receive goods / accept services | ✓ | ✓ | ✓ | ✓ (any user) |
| Match invoices | ✓ | ✓ | ✓ | ✓ (any user) |
| Approve invoices | – | – | ✓ | ✓ |
| Send PO to supplier | – | – | ✓* | ✓ (*UI shows the action to FINANCE and ADMIN only; the API accepts any authenticated user; SMTP must be configured) |
| Dispatch integrations | – | – | ✓ | ✓ |
| Run recurring-order generation | – | – | ✓ | ✓ |
| Upload attachments | ✓ | ✓ | ✓ | ✓ |
| Delete attachments | own only | own only | own only | any |
| Promote users / configure rules | – | – | – | ✓ (via DB today) |

Each rule has a `min_minor`, an optional `max_minor` (NULL = open-ended) and an
`approver_role`. An amount matches at most one bounded band (limits inclusive; on a
shared boundary the higher band wins), plus every open-ended rule whose
`min_minor` is at or below the amount, added as later steps. Overlapping bounded
bands or mixed currencies fail when a requisition is submitted. If no rule
matches, submit fails with "No approval rule matches this amount": there is no
automatic escalation. Add an open-ended rule (for example `ADMIN` with a higher
`min_minor`) if you want final sign-off on large POs.

## 5. Process management (systemd)

`/etc/systemd/system/hexprocure.service`:

```ini
[Unit]
Description=HexProcure
After=network.target postgresql.service

[Service]
User=hexprocure
WorkingDirectory=/opt/hexprocure/app
EnvironmentFile=/opt/hexprocure/app/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now hexprocure
```

### 5.1 Scheduled jobs (cron as the hexprocure user)

Create a machine token once as an admin:

```bash
curl -X POST https://procure.yourcompany.com/api/v1/auth/tokens   -H "content-type: application/json"   -H "origin: https://procure.yourcompany.com"   -H "cookie: hexprocure_session=<admin session cookie from your browser>"   -d '{"name":"cron"}'
# → {"id":"…","name":"cron","plaintext":"hxp_…"}: store it, it is shown only once
```

```cron
# drain integration outbox through every configured connector every 5 minutes
*/5 * * * * curl -s -X POST http://localhost:3000/api/v1/integrations/dispatch -H "Authorization: Bearer hxp_…" >/dev/null
# generate recurring requisitions daily at 06:00
0 6 * * * curl -s -X POST http://localhost:3000/api/v1/order-templates/run -H "Authorization: Bearer hxp_…" >/dev/null
```

Optionally, also set `INTEGRATION_DISPATCH_INTERVAL_MS` (for example `60000`) in `.env` and the app drains the integration outbox itself on that interval. The scheduler builds the connector registry from the environment on every run, so it delivers in a fresh process without any prior call to `POST /api/v1/integrations/dispatch`. The cron call above is then optional; keep it as a fallback or run it less often.

The scheduler runs inside the app process, skips a tick while the previous one is still running, and logs counts only. It is off when the variable is unset. Run it on a single app instance: multiple instances would each drain the outbox and may deliver an event twice.

Each event type can have several connectors, and every connector that handles that event type receives the event. The registry holds the CSV connector if `INTEGRATION_CSV_DIR` is set, the email connector, the QuickBooks connector if `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` are set, and the webhook connector if `INTEGRATION_WEBHOOK_URL` is set. Delivery is tracked per connector in `integration_events.delivered_connectors`, so a retry calls only the connectors that have not succeeded yet.

The token carries the role of the admin who created it; revoke and rotate from
`GET /api/v1/auth/tokens` and `DELETE /api/v1/auth/tokens/:id` (ADMIN only) without touching cron schedules.

### 5.2 OCR sidecar (optional)

```bash
cd /opt/hexprocure/app/services/ocr
docker build -t hexprocure-ocr .
docker run -d --name hexprocure-ocr --restart unless-stopped -p 127.0.0.1:8100:8100 hexprocure-ocr
# add INTEGRATION_OCR_URL=http://localhost:8100 to .env and restart the app
```

First start downloads PaddleOCR models (~hundreds of MB). Bound to localhost only.

## 6. Reverse proxy (nginx + TLS)

```nginx
server {
    listen 80;
    server_name procure.yourcompany.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name procure.yourcompany.com;

    ssl_certificate     /etc/letsencrypt/live/procure.yourcompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/procure.yourcompany.com/privkey.pem;

    client_max_body_size 12m;          # attachments + OCR uploads (10 MB cap + headroom)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
certbot --nginx -d procure.yourcompany.com
```

Cookies are `SameSite=Lax` and work over the proxied HTTPS domain unchanged.
Set `TRUST_PROXY=true` in `.env` so rate limits apply per client IP. Without it every client shares one bucket. With it the client is the right-most `X-Forwarded-For` hop, else `X-Real-IP`, if the value is a valid IP address. Limits per
minute and per client: 10 for login and register (`RATE_LIMIT_AUTH_PER_MIN`),
60 for API writes (`RATE_LIMIT_MUTATION_PER_MIN`), 300 for API reads, GET and
HEAD (`RATE_LIMIT_READ_PER_MIN`). The Playwright suite raises the auth limit
for its own web server only.
They are held in memory, per app process.
Set `INTEGRATION_REDIRECT_URI=https://procure.yourcompany.com/api/v1/integrations/qbo/callback`
when enabling QBO.

## 7. Post-deploy smoke test (5 minutes)

1. `curl -I https://procure.yourcompany.com/login` → 200
2. Register your account and promote it to ADMIN (§3.3); log in.
3. Insert approval rules; create supplier + cost center + current-month budget with SQL (no UI or API yet).
4. As a second (REQUESTER) account: create + submit a requisition → approver receives email (check SMTP).
5. Approve → order → verify budget reservation appears; download `/pdf`.
6. Upload an attachment to the requisition; download it back.
7. Trigger dispatch manually → confirm outbox drains (`integration_events.status='DELIVERED'`).
8. If OCR enabled: upload a PDF invoice → expect a draft response (first call is slow while models load).

## 8. Backups, updates, rollback

**Backups (daily cron, root):**

```bash
0 2 * * * sudo -u postgres pg_dump hexprocure | gzip > /var/backups/hexprocure-$(date +\%F).sql.gz
# attachments:
0 2 * * * tar czf /var/backups/hexprocure-files-$(date +\%F).tgz /opt/hexprocure/app/.data/uploads
# keep 30 days:
30 2 * * * find /var/backups -name 'hexprocure-*' -mtime +30 -delete
```

**Updating:** the app is stateless except `.env`, `DATA_DIR`, and the database.

```bash
cd /opt/hexprocure/app
sudo -u hexprocure git pull
sudo -u hexprocure npm ci
sudo -u hexprocure node --env-file=.env scripts/migrate.mjs
sudo -u hexprocure npm run build
systemctl restart hexprocure
```

**Rollback:** `git checkout <previous-tag-or-sha>`, rebuild, restart.
Migrations are forward-only: restore the DB dump taken before the update if a
migration must be undone.

## 9. Alternative: Docker Compose

Replaces §2 (server prep), §3 (application setup) and §5 (process management):
one command brings up app + Postgres 16 + the OCR sidecar, with healthchecks
and persistent volumes. You still need §4 (role model), §6 (reverse proxy,
point it at `localhost:3000`), §7 to §8 and §10.

### 9.1 Prerequisites

- Docker Engine and Compose v2 (`docker compose version`)
- Port 3000 free for the app (or set `APP_PORT` in `.env` to publish another host port)

### 9.2 Configuration

```bash
git clone https://github.com/maticijus/hexprocure.git && cd hexprocure
cp .env.example .env && chmod 600 .env
```

Edit `.env`: set `AUTH_SECRET` (`openssl rand -hex 32`) and any optional
integration variables. Ignore `DATABASE_URL` from the example: Compose
overrides it to point at the `db` service, and wires `INTEGRATION_OCR_URL` to
`http://ocr:8100`. Non-default Postgres credentials: set `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`.

### 9.3 Start & verify

```bash
docker compose up -d --build   # db → one-shot migrate → app (+ OCR sidecar)
curl -s localhost:3000/api/health   # {"status":"ok","database":true}
```

Migrations run automatically before the app starts (`_migrations` table tracks
applied files). Register your first admin as in §3.3 (set `ALLOW_SELF_REGISTRATION=true`
in `.env` first and recreate the app with `docker compose up -d`). Compose sets
`INTEGRATION_DISPATCH_INTERVAL_MS=60000` for the app, so the in-process
scheduler delivers events without any cron call. The dispatch cron line from
§5.1 is optional. Keep the recurring-order line and run it on the host against
`localhost:3000` (or your `APP_PORT`).

### 9.4 Data & lifecycle

| Volume | Contents | Survives `down` |
|---|---|---|
| `pgdata` | database | yes |
| `uploads` | attachments (mounted at the default `DATA_DIR`, `/app/.data/uploads`) | yes |

```bash
docker compose logs -f app     # troubleshoot
git pull && docker compose up -d --build   # update
docker compose down            # keeps volumes; add -v to wipe everything
```

Backups: `docker compose exec db pg_dump -U hexprocure hexprocure > backup.sql`
(replaces the bare-metal pg_dump in §8).

## 10. Security checklist before go-live

- [ ] `.env` chmod 600, owned by `hexprocure`, never committed
- [ ] `ALLOW_SELF_REGISTRATION` removed from `.env` after the users exist
- [ ] Strong unique `AUTH_SECRET`; separate `INTEGRATION_ENC_KEY` when QuickBooks is enabled
- [ ] Postgres listens on localhost only (`listen_addresses = 'localhost'`)
- [ ] ufw: only 22/80/443 open; OCR (8100) bound to 127.0.0.1; with Compose the app port is published on all interfaces, so keep `APP_PORT` closed at the network firewall
- [ ] Demo seed data absent; demo users deleted if ever seeded on prod copy
- [ ] Unattended-upgrades enabled; SSH key-only auth
- [ ] Backup restore rehearsed once (a backup you haven't restored is a rumor)
