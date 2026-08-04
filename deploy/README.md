# Hosting: Cloudflare + Mac mini

Replaces Vercel (app) + Neon (Postgres) with:

| Role | Component |
| --- | --- |
| Edge / TLS | **Cloudflare** (free Quick Tunnel **or** named tunnel + domain) |
| Path to your LAN | **cloudflared** — no open inbound ports |
| App + Postgres + uploads | **Mac mini** via Docker Compose |

```
Users → Cloudflare → Tunnel → Mac mini :3000 (Next.js)
                               └─ Postgres (127.0.0.1 only)
                               └─ Volume: screenshots / avatars
```

---

## Free only (no domain purchase)

You **do not need to buy a domain**. Use Cloudflare’s free **Quick Tunnel**:

```text
https://random-words.trycloudflare.com  →  your Mac mini :3000
```

| | |
| --- | --- |
| Cost | $0 (Cloudflare free + your Mac mini) |
| Signup | Not required for the free tunnel command |
| Domain | Not required |
| Catch | URL is **random** and **changes every time you restart** the tunnel |

### Steps

```bash
# One-time on the Mac mini
brew install cloudflared          # or: brew install cloudflare/cloudflare/cloudflared
chmod +x deploy/scripts/*.sh deploy/entrypoint.sh
./deploy/scripts/setup-mac-mini.sh
```

Edit `.env.production`:

1. Set a strong `POSTGRES_PASSWORD` (and the same password in `DATABASE_URL` / `DIRECT_URL`)
2. Leave **`BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` empty** (required for free mode — auth follows the trycloudflare host)

```bash
# Start app + database (stays on the Mini; not on the public internet yet)
./deploy/scripts/deploy.sh

# In another terminal: free public URL
./deploy/scripts/run-free-tunnel.sh
```

Copy the `https://….trycloudflare.com` line from the terminal and open it in a browser.

Stop only the tunnel with Ctrl+C; the app keeps running until you `docker compose … down`.

### Free mode limits (honest)

- Not a permanent team link — share the new URL after every tunnel restart.
- Fine for solo use, demos, and “is it up on the Mini?”.
- A **fixed** hostname forever requires *some* domain later. Cloudflare does not give a free permanent custom name without a zone.

---

## Prerequisites on the Mac mini

1. **Docker Desktop** or **Colima** running
2. **Git** + this repo cloned
3. **`cloudflared`** (`brew install cloudflared`) for free or domain tunnels
4. Domain only if you want a stable named tunnel (section below)

---

## Quick start (same for free / later domain)

```bash
cd ~/Apps/we-testcase-ms
chmod +x deploy/scripts/*.sh deploy/entrypoint.sh
./deploy/scripts/setup-mac-mini.sh
```

### Free path

Leave public URLs empty → `./deploy/scripts/deploy.sh` → `./deploy/scripts/run-free-tunnel.sh`

### Stable path (needs a domain you own)

When you add any domain to Cloudflare (even a cheap one):

```bash
cloudflared tunnel login
cloudflared tunnel create wetestcase
cloudflared tunnel route dns wetestcase app.yourdomain.com
```

Copy credentials into `deploy/cloudflared/`, set hostname in `config.yml`, then:

```bash
# Set in .env.production:
#   BETTER_AUTH_URL=https://app.yourdomain.com
#   NEXT_PUBLIC_APP_URL=https://app.yourdomain.com
./deploy/scripts/deploy.sh --tunnel
# or tunnel as LaunchDaemon:
./deploy/scripts/install-tunnel-launchd.sh
```

Service URL in config:

- Tunnel in Docker: `http://app:3000`
- Tunnel on Mac host: `http://127.0.0.1:3000`

---

## Start / seed

Local health: `http://127.0.0.1:3000/api/health`

Optional first-time seed:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec app \
  npx tsx prisma/seed.ts
```

Change demo passwords immediately.

---

## Day-to-day

| Task | Command |
| --- | --- |
| Deploy latest code | `./deploy/scripts/deploy.sh --pull` |
| Free public URL again | `./deploy/scripts/run-free-tunnel.sh` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| DB backup | `./deploy/scripts/backup-db.sh` |
| DB restore | `./deploy/scripts/restore-db.sh deploy/backups/….sql.gz` |
| Stop app | `docker compose -f docker-compose.prod.yml --env-file .env.production down` |

Suggested nightly backup (crontab on the Mac mini):

```cron
15 3 * * * /Users/YOU/Apps/we-testcase-ms/deploy/scripts/backup-db.sh >> /tmp/wetestcase-backup.log 2>&1
```

---

## Cloudflare checklist (stable domain only)

1. Domain nameservers → Cloudflare
2. DNS usually created by `cloudflared tunnel route dns`
3. SSL/TLS: **Full** is fine with tunnels
4. Do **not** port-forward 3000/5432 on your router

---

## Migrating off Neon (optional)

```bash
pg_dump "$NEON_DATABASE_URL" --clean --if-exists | gzip > neon-export.sql.gz
./deploy/scripts/restore-db.sh ./neon-export.sql.gz
```

Screenshots only ever stored on Vercel’s ephemeral disk usually cannot be recovered.
