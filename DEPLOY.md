# Deploying Establo to Fly.io

The whole system is one Fastify service + Postgres (with pgvector) + a volume
for uploaded files. pg-boss runs inside the service — no extra workers.

## 1. Prereqs

```bash
curl -L https://fly.io/install.sh | sh   # flyctl
fly auth login
```

## 2. Create the app (no deploy yet)

```bash
fly launch --no-deploy --copy-config --name <your-app-name>
# keeps the committed fly.toml; pick a region close to the dairy (e.g. sea, den)
```

If you change the app name/region, update `app`/`primary_region` in `fly.toml`.

## 3. Postgres with pgvector

```bash
fly postgres create --name <your-app-name>-db --region <region>
fly postgres attach <your-app-name>-db --app <your-app-name>
# attach sets DATABASE_URL as a secret on the app
```

Fly Postgres (postgres-flex) ships the pgvector extension; the first migration
runs `CREATE EXTENSION IF NOT EXISTS vector`. The release command
(`pnpm migrate`, see fly.toml) applies migrations on every deploy.

## 4. Volume for uploads/audio/PDFs

```bash
fly volumes create establo_data --region <region> --size 10 --app <your-app-name>
```

`fly.toml` mounts it at `/data` and sets `DATA_DIR=/data/storage`.

## 5. Secrets

```bash
fly secrets set \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  PUBLIC_BASE_URL="https://<your-app-name>.fly.dev" \
  ANTHROPIC_API_KEY="sk-ant-..." \
  OPENAI_API_KEY="sk-..." \
  TWILIO_ACCOUNT_SID="AC..." \
  TWILIO_AUTH_TOKEN="..." \
  TWILIO_WHATSAPP_FROM="whatsapp:+1XXXXXXXXXX" \
  --app <your-app-name>
```

`RUN_MODE=production` is already set in `fly.toml` (`[env]`).
Optional billing: `ENABLE_BILLING=true`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASE`, `STRIPE_PRICE_PER_COW`.

## 6. Deploy

```bash
fly deploy
fly status
curl https://<your-app-name>.fly.dev/healthz   # {"ok":true,"mode":"production",...}
```

First-run setup: open `https://<your-app-name>.fly.dev/app`, use the
**Set up a dairy** tab to create the org + owner account. (Seed data is for
local dev; don't seed production.)

## 7. Point Twilio at the deployment

In the Twilio Console → your WhatsApp sender (or sandbox while testing):

- **When a message comes in:**  `https://<your-app-name>.fly.dev/webhooks/twilio` (POST)
- **Status callback URL:**      `https://<your-app-name>.fly.dev/webhooks/twilio/status`

Production validates `X-Twilio-Signature` against `PUBLIC_BASE_URL` — if you
put the app behind a different hostname, update that secret or every webhook
will be rejected with 403.

## 8. WhatsApp Business prerequisites (timeline matters)

1. **Meta business verification** via Twilio — typically **days**. Start first.
2. Register your WhatsApp sender number — approval via Twilio console.
3. Submit both utility templates (copy in `src/server/services/messages.es.ts`):
   `establo_module_notify`, `establo_check_reminder` — usually **minutes–hours**.
   Drip lessons can't reach a worker whose 24h window is closed until these
   are approved (the in-window path works immediately).

## Notes

- **Scaling:** keep `min_machines_running = 1` and a single machine. The drip
  cron and the in-memory rate limiter assume one process (see DECISIONS.md).
- **Backups:** Fly Postgres has daily snapshots; `fly volumes snapshots list`
  covers the file volume. The audit-critical data (training_events) lives in
  Postgres.
- **Logs:** `fly logs`. Worker phone numbers are masked in application logs.
