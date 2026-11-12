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

## Free public URL: this app's own tunnel

`npm run tunnel:own` runs a Cloudflare Quick Tunnel in Docker, straight to
`app:3000`, and we-testcase depends on nothing outside this repo:

```bash
npm run tunnel:own       # start it (leave it running)
npm run tunnel:own:url   # print the https://....trycloudflare.com URL
# -> https://....trycloudflare.com/cases/
```

Every other app on the Mac mini (OhMyCMO, POS168) already runs its own tunnel
this way. The hostname is random and a restart mints a new one; for a URL that
never changes, see **Stable tunnel** below.

`tunnel:own` passes `--no-deps`, so it starts the tunnel without touching the
running app or database. It brings up two containers: the tunnel and a small
nginx (`deploy/web/nginx.conf`) that sits between them.

That proxy is not optional. Cloudflare percent-encodes `( )` and `[ ]` in the
`/_next/static` chunk paths Next.js generates from route groups and dynamic
segments, and Next.js 15 returns 404 when both are encoded in one URL, so
pages fail with *Loading chunk … failed*. nginx's `$uri` is already decoded,
so `proxy_pass http://app$uri` hands the app a path it can match. Pointing
cloudflared straight at `app:3000` reintroduces the bug.

### The shared edge proxy is no longer here

`/cases/` is also reachable through the Mac mini edge — one nginx and one
tunnel fronting several projects. That edge used to live in this repo at
`deploy/edge`, which meant we-testcase owned five other projects' routing and
`npm run edge:up` from here decided whether they had a public URL.

It now lives on its own:

```bash
cd ~/Projects/macmini-edge
./scripts/run-edge.sh
./scripts/run-edge-free-tunnel.sh
```

Nothing in this repo starts, stops or configures it. If `/cases/` needs to
change on the shared hostname, edit `nginx.conf` there. Use `tunnel:own` above
for a URL this repo controls end to end.

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

## Telegram: two bots

| Bot | Posts | Reads |
| --- | --- | --- |
| App | PO questions, PO answers, comments, requirements waiting on the PO | `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` |
| Deploy | ✅ / ❌ after every CI deploy | `DEPLOY_TELEGRAM_BOT_TOKEN` / `DEPLOY_TELEGRAM_CHAT_ID` |

Separate bots, and usually separate chats: build results stay out of the group
QA works in, and either can be re-pointed or revoked without touching the
other. Nothing falls back from one pair to the other — sharing a bot is what
let the two drift apart unnoticed.

The app reads its pair from `.env.production` only. The deploy script takes
its pair from the environment first (GitHub repository secrets of the same
names) and from `.env.production` otherwise, so either place works:

```ini
# .env.production on the Mac mini
TELEGRAM_BOT_TOKEN="123456:ABC…"          # @BotFather, app bot
TELEGRAM_CHAT_ID="-1001234567"            # the QA group

DEPLOY_TELEGRAM_BOT_TOKEN="987654:XYZ…"   # @BotFather, a second bot
DEPLOY_TELEGRAM_CHAT_ID="-1009876543"     # a build channel
```

Add each bot to its chat first, then read the chat id from
`https://api.telegram.org/bot<token>/getUpdates`.

### When a notification does not arrive

`deploy/scripts/notify-deploy-telegram.sh` prints what Telegram said:

```
Telegram refused the deploy notification: chat not found
Check DEPLOY_TELEGRAM_CHAT_ID, and that the deploy bot is in that chat.
```

The step this replaced ended at a bare `curl` with no `--fail` and nothing
reading the reply, so a refusal exited 0 and the step went green having sent
nothing. That is how deploy notices were missing for days while the workflow
reported success. A notification still never fails a deploy — it reports and
exits 0.

---

## Day-to-day

| Task | Command |
| --- | --- |
| Redeploy app only (tunnel stays up) | push to `main` (or `npm run docker:stack:up`) |
| Free public URL — in Docker (preferred) | `npm run tunnel:own` |
| Print that URL | `npm run tunnel:own:url` |
| Free public URL — host `cloudflared` | `npm run tunnel:free` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| Bring crashed containers back now | `./deploy/scripts/autostart.sh` |
| DB backup | `./deploy/scripts/backup-db.sh` |
| DB restore | `./deploy/scripts/restore-db.sh deploy/backups/….sql.gz` |
| Stop app | `docker compose -f docker-compose.prod.yml --env-file .env.production down` |

---

## After a reboot or a Docker crash

When Docker Desktop dies under the containers they stop with exit code 255,
and the restart policy does not always bring them back. That took the app,
the edge and the tunnel down unnoticed for three weeks in October 2026.

One-time, on the Mac mini, as the Docker Desktop user:

```bash
./deploy/scripts/install-autostart.sh
```

The LaunchAgent runs `deploy/scripts/autostart.sh` at login and every 5 minutes.
It opens Docker Desktop if it is closed, then starts the `wetestcase-*`
containers if they are stopped with exit code 255. The shared edge
(`macmini-edge`, `macmini-tunnel`) autostarts from `~/Projects/macmini-edge`,
not from here.
It never builds or recreates anything, and it leaves containers stopped on
purpose alone. Log: `~/Library/Logs/wetestcase-autostart.log` (it also prints
the new tunnel URL when it restarts the tunnel).

A LaunchAgent only runs once someone is logged in, so also set:

1. **System Settings → Users & Groups → Automatically log in as** this user
   (not available while FileVault is on).
2. **Docker Desktop → Settings → General → Start Docker Desktop when you sign in.**
3. **System Settings → Energy → Start up automatically after a power failure.**

Remove it with `./deploy/scripts/install-autostart.sh --uninstall`.

---

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
