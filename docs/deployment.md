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

### 3.1 Configuration — `/opt/hexprocure/app/.env` (chmod 600)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://hexprocure:PASSWORD@localhost:5432/hexprocure` |
| `AUTH_SECRET` | ✅ | Session signing secret. `openssl rand -base64 32`. Rotating it logs everyone out. Min 8 chars. |
| `SMTP_URL` | ⚠️ rec. | e.g. `smtp://user:pass@smtp.provider.com:587`. Without it notifications are logged, not sent. |
| `SMTP_FROM` | w/ SMTP | Sender address, e.g. `procurement@yourcompany.com` |
| `INTEGRATION_OCR_URL` | optional | OCR sidecar, e.g. `http://localhost:8100`. Unset = invoice intake disabled (501). |
| `DATA_DIR` | optional | Attachment storage root (default `.data/uploads`). Put it OUTSIDE the repo dir if you deploy by re-cloning. |
| `INTEGRATION_WEBHOOK_URL` | optional | Push events to an external endpoint |
| `INTEGRATION_WEBHOOK_SECRET` | optional | HMAC key receivers verify (`X-HexProcure-Signature`) |
| `INTEGRATION_ENC_KEY` | for §6 | AES-256-GCM key for OAuth tokens (`openssl rand -base64 32`) |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | for §6 | Intuit app credentials |
| `INTEGRATION_REDIRECT_URI` | for §6 | Must match Intuit app registration |

**Never commit `.env`. It contains session-signing and database secrets.**

### 3.2 Database schema

```bash
npx drizzle-kit migrate        # applies all migrations in drizzle/
```

Do NOT run `scripts/seed.ts` in production — it creates demo accounts with a
public password.

### 3.3 First login & first admin

1. Open the site → register your account (defaults to role `REQUESTER`).
2. Promote yourself from the server:

```bash
sudo -u postgres psql hexprocure \
  -c "UPDATE users SET role='ADMIN' WHERE email='you@yourcompany.com';"
```

3. As ADMIN: configure suppliers, cost centers, budgets and approval rules
   (approval rules currently via DB insert into `approval_rules`; UI is roadmap).
   Example ruleset:

```sql
INSERT INTO approval_rules (sequence, min_minor, max_minor, approver_role) VALUES
  (1, 0,      50000,   'MANAGER'),
  (2, 50000,  NULL,    'FINANCE');
```

4. Register the other users (their default role fits: employees = REQUESTER;
   promote team leads to MANAGER, accounting to FINANCE).

## 4. Role model

Assigned via `users.role`; enforced per endpoint and in the UI.

| Capability | REQUESTER | MANAGER | FINANCE | ADMIN |
|---|---|---|---|---|
| Create/submit requisitions | ✓ | ✓ | ✓ | ✓ |
| Approve/reject own band's items | – | ✓ | ✓ | ✓ (any step) |
| Receive goods / accept services | ✓ | ✓ | ✓ | ✓ |
| Match invoices | – | – | ✓ | ✓ |
| Approve invoices | – | – | ✓ | ✓ |
| Send PO to supplier | – | – | ✓* | ✓ (*any authenticated can POST; transport must be configured) |
| Dispatch integrations | – | – | ✓ | ✓ |
| Run recurring-order generation | – | – | ✓ | ✓ |
| Upload attachments | ✓ | ✓ | ✓ | ✓ |
| Delete attachments | own only | own only | own only | any |
| Promote users / configure rules | – | – | – | ✓ (via DB today) |

Escalation rule of thumb: amounts above the highest band ceiling route to
FINANCE; add an open-ended ADMIN band if you want final sign-off on huge POs.

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

```cron
# drain integration outbox (CSV/webhook/email/QBO) every 5 minutes
*/5 * * * * cd /opt/hexprocure/app && curl -s -X POST http://localhost:3000/api/v1/integrations/dispatch -H "cookie: <admin-session>" >/dev/null
# generate recurring requisitions daily at 06:00
0 6 * * * curl -s -X POST http://localhost:3000/api/v1/order-templates/run -H "cookie: <admin-session>" >/dev/null
```

> The run endpoints authenticate with an admin session cookie. For unattended
> cron, create a dedicated ADMIN account, log in once, and store its cookie;
> a machine-token endpoint is on the roadmap (see Known gaps).

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
    }
}
```

```bash
certbot --nginx -d procure.yourcompany.com
```

Cookies are `SameSite=Lax` and work over the proxied HTTPS domain unchanged.
Set `INTEGRATION_REDIRECT_URI=https://procure.yourcompany.com/api/v1/integrations/qbo/callback`
when enabling QBO.

## 7. Post-deploy smoke test (5 minutes)

1. `curl -I https://procure.yourcompany.com/login` → 200
2. Register your account; promote to ADMIN (§3.3); re-login.
3. Insert approval rules; create supplier + cost center + current-month budget as ADMIN (or SQL).
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
0 2 * * * tar czf /var/backups/hexprocure-files-$(date +\%F).tgz /opt/hexprocure/.data/uploads
# keep 30 days:
30 2 * * * find /var/backups -name 'hexprocure-*' -mtime +30 -delete
```

**Updating:** the app is stateless except `.env`, `DATA_DIR`, and the database.

```bash
cd /opt/hexprocure/app
sudo -u hexprocure git pull
sudo -u hexprocure npm ci
sudo -u hexprocure npx drizzle-kit migrate
sudo -u hexprocure npm run build
systemctl restart hexprocure
```

**Rollback:** `git checkout <previous-tag-or-sha>`, rebuild, restart.
Migrations are forward-only — restore the DB dump taken before the update if a
migration must be undone.

## 9. Alternative: Docker Compose

A compose file wrapping app + Postgres + OCR sidecar is a welcome contribution
(roadmap). The pieces above map 1:1: three services, one volume each, same env
vars, same cron entry points.

## 10. Security checklist before go-live

- [ ] `.env` chmod 600, owned by `hexprocure`, never committed
- [ ] Strong unique `AUTH_SECRET`; separate `INTEGRATION_ENC_KEY` when §6 lands
- [ ] Postgres listens on localhost only (`listen_addresses = 'localhost'`)
- [ ] ufw: only 22/80/443 open; app (3000) and OCR (8100) bound to 127.0.0.1
- [ ] Demo seed data absent; demo users deleted if ever seeded on prod copy
- [ ] Unattended-upgrades enabled; SSH key-only auth
- [ ] Backup restore rehearsed once (a backup you haven't restored is a rumor)
