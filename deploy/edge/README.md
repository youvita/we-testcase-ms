# Mac mini edge: one nginx + one Cloudflare tunnel for many projects

```text
Internet → Cloudflare → cloudflared (1 process)
                           → nginx :8080
                                ├─ /cases/       → :3000  we-testcase (basePath=/cases)
                                ├─ /securescan/  → :3001  SecureScan (basePath=/securescan)
                                └─ (add more upstreams in nginx.conf)
```

**One terminal, one public URL** (free Quick Tunnel):

```bash
npm run edge:up
npm run tunnel:edge   # leave running — do NOT also run tunnel:free
```

Then open:

- `https://….trycloudflare.com/cases/`
- `https://….trycloudflare.com/securescan/`

> Same edge exists in `secure-scanner/deploy/edge`. Container name is
> `macmini-edge` on port **8080** — start it from **either** repo, not both.

Apps must be built with `BASE_PATH` (Docker defaults: `/cases` and `/securescan`).
Redeploy apps after changing basePath; nginx does **not** strip prefixes.

## Local without Cloudflare

- http://127.0.0.1:3000/cases
- http://127.0.0.1:3001/securescan/login
- or via edge: http://127.0.0.1:8080/cases/ and http://127.0.0.1:8080/securescan/

## Named tunnel + domain (optional later)

Hostname routing still works (see `deploy/cloudflared/config.edge.example.yml`).
With a domain you can also drop path prefixes later by building with empty `BASE_PATH`.

## Memory

| Old way | New way |
|---------|---------|
| N × `cloudflared` + N terminals | 1 × nginx + 1 × `cloudflared` |
