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

## Many projects: one nginx + one tunnel (recommended)

Avoid one `cloudflared` / terminal per repo. Use the shared edge proxy (also in SecureScan):

```text
Internet → Cloudflare → cloudflared (1 process) → nginx :8080
                                                   ├─ /cases/       → :3000
                                                   └─ /securescan/  → :3001
```

```bash
npm run edge:up      # nginx on 127.0.0.1:8080
npm run tunnel:edge  # one free trycloudflare URL → edge (leave running)
# → https://….trycloudflare.com/cases/
# → https://….trycloudflare.com/securescan/
```

Do **not** also run `tunnel:free` if you use `tunnel:edge`.

Details: [edge/README.md](./edge/README.md). Start edge from **either** this repo or `secure-scanner` — not both (same `macmini-edge` container).

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
# Start app + database
npm run docker:stack:up

# Terminal 1 — start once, leave it running
npm run tunnel:free
# copy the https://….trycloudflare.com URL

# Later — redeploy app only (tunnel stays up → same URL)
npm run docker:stack:up
```

Copy the `https://….trycloudflare.com` line from Terminal 1 and open it in a browser.

Do **not** Ctrl+C Terminal 1 while people still need that link. Redeploys go in another terminal.

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

Leave public URLs empty → `npm run docker:stack:up` → `npm run tunnel:free` (leave running).

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

## CI/CD (GitHub Actions)

Pushes and merges to `main` lint/typecheck on GitHub, then deploy on this Mac mini.
The workflow rebuilds the **app** only — the Cloudflare tunnel is not touched.

### One-time runner

1. Docker Desktop running, stack already set up (`setup-mac-mini.sh`).
2. Create a runner registration token:
   - **Org (preferred):** GitHub org → Settings → Actions → Runners → New runner  
     One runner serves both `we-testcase-ms` and `secure-scanner`.
   - **Repo:** this repo → Settings → Actions → Runners → New runner
3. On the Mac mini, as the Docker Desktop user (not root):

```bash
./deploy/scripts/install-github-runner.sh \
  --url https://github.com/youvita \
  --token <registration-token>
```

That installs a user LaunchAgent labeled `macmini`. Keep Docker Desktop running.

4. If `.env.production` is **not** at `~/Apps/we-testcase-ms/` or
   `~/Projects/we-testcase-ms/`, add a repository variable:

   - `DEPLOY_ENV_FILE` = absolute path to `.env.production` on this Mac

Secrets stay on disk. Do not put `.env.production` in GitHub secrets.

### After that

| Task | How |
| --- | --- |
| Deploy | Merge / push to `main` |
| Deploy without a new commit | GitHub → Actions → CI/CD → Run workflow |
| Manual fallback | `npm run docker:stack:up` |

The Actions checkout is a separate work folder. Named Docker volumes and
containers stay the same (`name: we-testcase-ms` in `docker-compose.prod.yml`).

---

## Day-to-day

| Task | Command |
| --- | --- |
| Redeploy app only (tunnel stays up) | push to `main` (or `npm run docker:stack:up`) |
| Edge proxy (many apps, one port) | `npm run edge:up` |
| Free public URL via edge (once, leave running) | `npm run tunnel:edge` |
| Free public URL — this app only | `npm run tunnel:free` |
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
