# TestCase MS — Online Test Case Management

A web-based test case management system that replaces Excel-based test execution
while letting teams keep using their existing Excel templates.

QA imports a spreadsheet, executes the cases online, and developers get a live
read-only view of what is failing. Nobody edits a shared `.xlsx` mid-cycle again.

QA can also start from the PRD or FRD instead of a spreadsheet: Claude reads the
document into testable requirements and drafts black-box test cases for them,
which QA reviews before they join the test plan. Every case traces back to the
requirements it verifies.

This is **not** a bug tracker.

---

## Stack

| Layer      | Choice                                        |
| ---------- | --------------------------------------------- |
| Layout     | **npm workspaces monorepo** (`apps/*`, `packages/*`) |
| Web app    | **Next.js 15** (App Router) + React 19 — `apps/web` |
| Shared DTOs| **`@wetestcase/dto`** — Zod schemas, enums, pure response types |
| Language   | TypeScript (`strict`, `noUncheckedIndexedAccess`) |
| Styling    | Tailwind CSS v3 + shadcn/ui (new-york)        |
| Database   | PostgreSQL via Prisma 6 (`apps/web/prisma`)   |
| Auth       | Better Auth (email + password)                |
| Excel      | SheetJS (`xlsx`)                              |
| PDF        | `pdf-lib`                                     |
| Charts     | Recharts                                      |
| Validation | Zod (dto package) + react-hook-form           |

---

## Repository layout

```
we-testcase-ms/
  apps/web/              # Next.js app (UI, API routes, services, Prisma)
  apps/runner/           # Automation runner (Playwright), separate container
  packages/dto/          # Shared DTOs (@wetestcase/dto)
  deploy/                # Mac mini + Cloudflare hosting scripts
  docker-compose*.yml
  package.json           # workspace root — run scripts from here
```

Import shared contracts anywhere:

```ts
import { testCaseSchema, type TestCaseInput, ROLES } from "@wetestcase/dto";
```

`apps/web` still re-exports many of these via `@/lib/validations`, `@/lib/constants`,
and `@/types` for existing app code.

---

## Getting started

### 1. Install (monorepo root)

```bash
npm install
```

### 2. Configure

Next.js loads env from **`apps/web`**:

```bash
cp .env.example apps/web/.env
# or: cp apps/web/.env.example apps/web/.env
```

Then set a real auth secret:

```bash
openssl rand -base64 32
```

Paste the result into `BETTER_AUTH_SECRET`.

### 3. Start PostgreSQL

A `docker-compose.yml` is included, and its credentials already match the
`DATABASE_URL` in `.env.example`:

```bash
docker compose up -d
```

Using your own Postgres instead? Just point `DATABASE_URL` at it.

### 4. Create the schema

```bash
npm run db:migrate
```

> This project ships the Prisma **schema** rather than a committed migration
> history — the command above generates the initial migration against your
> database. For a throwaway environment, `npm run db:push` is faster.

### 5. Seed demo data (optional)

```bash
npm run db:seed
```

Creates one project (6 modules, 20 test cases, execution history) and three
accounts — one per role:

| Email                 | Password       | Role      |
| --------------------- | -------------- | --------- |
| `admin@example.com`   | `Password123!` | Admin     |
| `qa@example.com`      | `Password123!` | QA        |
| `dev@example.com`     | `Password123!` | Developer |

Change these before deploying anywhere real.

### 6. Run

```bash
npm run dev
```

Open http://localhost:3000.

---

## Production (Cloudflare + Mac mini)

Self-host on a Mac mini. **No domain purchase required** for the free path
(Cloudflare `*.trycloudflare.com`).

Day-to-day deploys are **GitHub Actions**: push (or merge) to `main` and the
Mac mini self-hosted runner rebuilds the app. The Cloudflare tunnel is not
restarted.

First-time host setup:

```bash
chmod +x deploy/scripts/*.sh deploy/entrypoint.sh
./deploy/scripts/setup-mac-mini.sh
# edit .env.production — set DB password; leave public URLs empty
npm run docker:stack:up

# Terminal 1 — start once, leave it running
npm run tunnel:free
# copy the https://….trycloudflare.com URL

# One-time: register the GitHub Actions runner (see deploy/README.md)
./deploy/scripts/install-github-runner.sh \
  --url https://github.com/youvita \
  --token <registration-token>
```

After that, merge to `main` instead of running `docker:stack:up` by hand.
Manual fallback: **Actions → CI/CD → Run workflow**, or `npm run docker:stack:up`.

Full guide (CI/CD, free tunnel, optional fixed domain): [deploy/README.md](deploy/README.md).

---

## Roles

Enforced centrally in [`lib/permissions.ts`](lib/permissions.ts) — API routes
and pages both derive their decisions from it, so the read-only guarantee lives
in one place.

| Capability                  | Admin | QA  | Developer |
| --------------------------- | :---: | :-: | :-------: |
| View projects & test cases  |   ✓   |  ✓  |     ✓     |
| View results, comments, screenshots | ✓ | ✓ |     ✓     |
| Download Excel/PDF reports  |   ✓   |  ✓  |     ✓     |
| Create/edit projects & modules |  ✓  |  ✓  |     —     |
| Import Excel, edit test cases |  ✓  |  ✓  |     —     |
| Record execution results    |   ✓   |  ✓  |     —     |
| Delete a project            |   ✓   |  —  |     —     |
| Manage users and roles      |   ✓   |  —  |     —     |

New sign-ups get the **QA** role. Roles are assigned by an Admin — `role` is
declared `input: false` in the Better Auth config, so a client cannot choose its
own role at sign-up.

---

## Excel import

Upload your existing template — headings are matched case- and
punctuation-insensitively, so `TC ID`, `tc_id`, `Test Case ID` and `Case No.`
all resolve to the same field.

| Canonical field  | Accepted headings (examples)                          |
| ---------------- | ----------------------------------------------------- |
| `tcId`           | TC ID, Test Case ID, Case No., ID, No.                |
| `module`         | Module, Feature, Functionality, Component, Screen      |
| `title`          | Test Case, Description, Test Scenario, Summary         |
| `preconditions`  | Preconditions, Prerequisite, Setup, Given              |
| `steps`          | Steps, Test Steps, Procedure, Action, When             |
| `expectedResult` | Expected Result, Expected Output, Then                 |
| `priority`       | Priority, Severity, Importance, Risk                   |

Priority values are normalised generously: `P0`/`Blocker`/`Critical` → `CRITICAL`,
`Major` → `HIGH`, `Normal` → `MEDIUM`, `Minor`/`Trivial` → `LOW`.

Import behaviour:

- A title/logo row above the real headings is skipped — the header row is
  detected by scanning the first 20 rows.
- Blank rows are skipped and counted.
- A TC ID repeated **within the file** keeps its first occurrence.
- A TC ID that already exists **in the project** is either skipped or updated,
  your choice at upload time.
- Rows with content but no TC ID are imported as `ROW-<n>` and flagged.
- Modules named in the sheet are created automatically.
- **Re-importing never overwrites recorded results** — status, timestamps and
  execution history are untouched.
- The whole import runs in one transaction, so a failure leaves no partial data.
- Every decision is reported in an import summary, including which columns were
  ignored.

Grab a starter file from **Download a blank template** in the import dialog, or
`GET /api/import-template`.

---

## Reports

Both are readable by all three roles.

**Excel** (`/api/projects/:id/reports/excel`) — three sheets: Summary (project
metadata, execution statistics, per-module progress), Test Cases (every case with
its latest result, comment, tester and screenshot names, with an autofilter), and
Failed & Blocked.

**PDF** (`/api/projects/:id/reports/pdf`) — project summary, execution
statistics with a stacked status bar, per-module progress table, then each failed
and blocked case with expected vs actual result and the QA comment.

---

## Requirements & AI

Project → **Requirements** (`/projects/:id/requirements`).

1. **Documents** — upload a PRD/FRD (PDF, Word `.docx`, Markdown, text, HTML) or
   paste it. Only the extracted text is kept. Scanned PDFs have no text and need
   OCR first.
2. **Requirements** — Claude reads the document into requirements: code, title,
   description, acceptance criteria and the *open questions* a tester would need
   answered. Long documents are read in parts. Reading a document again updates
   requirements by code, so links to test cases survive a PRD revision.
3. **Draft test cases** — select requirements, pick platform and depth, and
   Claude writes black-box cases (preconditions, steps with test data, expected
   result, type, priority, module).
4. **Review drafts** — edit, accept or reject, one by one or in bulk. Accepting
   creates the test case (and its module if new) with a TC ID derived from the
   requirement, e.g. `TC-FR-012-01`, linked for traceability. Nothing the AI
   writes becomes a test case without this step.

Coverage (which requirements have tests, and their latest results) is on the
requirements page; each test case lists the requirements it verifies.

**No document? Explore the app.** *Explore the app* (Review drafts, or
*Suggest with AI* on the test case list) suggests cases from the application
itself: the runner opens up to five pages — after signing in with an automated
case's script, for pages behind login — and captures each page's outline and a
screenshot; Claude suggests positive, negative, validation and boundary cases
for what is actually there, skipping cases the project already has or has
pending, plus a few observations that are not test cases. Suggestions land in
Review drafts like any other.

**Whose Claude.** AI runs on each person's own Claude Pro/Max subscription —
there is no shared key. Each person installs the Claude CLI once
(`npm install -g @anthropic-ai/claude-code`), runs `claude setup-token`, signs in
with the account that has the plan, and pastes the printed `sk-ant-oat01-…`
token under account menu → *Claude subscription*. It is
stored encrypted (AES-256-GCM, key derived from `BETTER_AUTH_SECRET` or
`CLAUDE_TOKEN_SECRET`) and never sent back to the browser. API keys are refused.

**The bridge.** The app speaks the Anthropic Messages API to the `claude-bridge`
container (`scripts/claude-bridge.mjs`, built by `deploy/bridge.Dockerfile` — the
same bridge WePlanner uses), which runs `claude --print` as the caller's token
with all tools disabled. In dev, `docker compose up -d claude-bridge` publishes it
on `127.0.0.1:8788` and `CLAUDE_BRIDGE_URL` points there; in production it sits
on the internal network with no published port. Because the client is plain
Messages API, moving to an Anthropic API key later is a config change.

**Jobs.** AI work runs in the background inside the app process (the Cloudflare
tunnel cuts requests at 100 s); the page polls and refreshes when a job ends.
One person's jobs run one at a time, since they share that person's usage
limits. A restart loses in-flight jobs; they are marked failed with a "run it
again" message rather than left spinning.

---

## Automation

Project → **Automation** (`/projects/:id/automation`). Web and API cases can be
automated; iOS and Android come later (they need emulators or devices).

1. **Environments** — per project: a Web base URL, an API base URL and
   variables (`vars.USER_EMAIL`). Secret variables are encrypted, never sent
   back to the browser, and only the runner receives them at run time.
2. **Scripts** — on a test case, under *Automation*: the body of one
   Playwright test. `page` (Web) or `request` (API), `expect`, `env` and `vars`
   are in scope. Paths join onto the base URL, so `request.get("/users")` on
   `https://sit.example.com/api/v1` calls `…/api/v1/users`.
3. **Runs** — every automated case, the failing ones, one module, or a single
   case (*Run this case*). Each result comes back with a screenshot, a trace
   (open at trace.playwright.dev) and, on failure, a video.
4. **Results** — passes and failures are recorded as executions, so the
   dashboard and reports include them; the history marks them *Automated · Run
   #N*. A script that breaks on its own mistake (syntax error, TypeError) is a
   *script error*: it is reported on the run but does not mark the case failed.
   Untick *Record results* to try scripts without touching results.

**Claude writes and explains scripts.** On a Web or API case, *Write with
Claude* writes the script against a real environment, not from the steps
alone: the runner opens the start page and returns its outline (Playwright's
aria snapshot — every field and button by role and name); Claude drafts from
the case and that outline; the runner tries the draft as a *script check*
(recorded nowhere, numbered nowhere); on failure Claude sees the error, the
screenshot and the outline of the page where it stopped, and repairs it — up
to three tries. It stops early when it judges the product, not the script, is
wrong (it never weakens an assertion to pass) or when it needs something only
QA has, such as an account or an OTP bypass. QA reviews the result and chooses
*Use this script*; nothing is saved on its own. For many cases at once, select them on the test case
list and choose *Write scripts with Claude*: they are written one after
another (they share one subscription), a script that passed can be saved
straight away while anything else waits on its case for review, progress shows
above the list, and *Stop the rest* cancels cases that have not started.
On a run, *Ask Claude why* (or
*Explain failures*) sorts each failure into product bug, script problem,
environment or unclear, with a corrected script to apply or a bug report to
copy. Claude is told variable names, never their values.

**The runner** (`apps/runner`) is a separate container built on the Playwright
image. It holds no database credentials: it claims queued runs from
`/api/runner/*` with a shared `RUNNER_TOKEN`, runs them, and posts results
back. A script that does not load is set aside so it cannot stop the rest of
the run. Runs can be cancelled mid-way; a runner that stops responding has its
run marked *Error* after 90 seconds.

```bash
# dev — app on the host (npm run dev), runner in Docker
echo 'RUNNER_TOKEN="dev-runner-token"' >> apps/web/.env      # then restart npm run dev
docker compose --profile automation up -d runner

# production — add RUNNER_TOKEN to .env.production (any long random string), then
docker compose -f docker-compose.prod.yml --env-file .env.production up -d app
docker compose -f docker-compose.prod.yml --env-file .env.production --profile automation up -d --build runner
```

**Watch live.** *New run*, *Run this case* and *Write with Claude* have a
*Watch live* option: the run page then shows what each Web test's browser
shows, a few frames a second (Chrome's screencast, relayed by the app and kept
in memory only), with an optional slow motion of 0.5 s or 1.2 s between
actions so a person can follow. Off, runs stay in the background. Test
processes never receive `RUNNER_TOKEN`; a watched run gets its own token,
good only for posting that run's frames.

**A real browser window (developers).** On your own Mac, run the runner
outside Docker with `HEADED=1` and Chrome opens on your screen:

```bash
docker compose --profile automation stop runner        # so it does not take the run first
cd apps/runner && npx playwright install chromium       # once
APP_URL=http://localhost:3001 RUNNER_TOKEN=dev-runner-token HEADED=1 node src/index.ts
```

This only helps whoever sits at the machine running the runner; for everyone
else, use *Watch live*.

Inside the runner container `localhost` is the container: a script aimed at
something on the same machine must use `host.docker.internal`. The image is
large (~3.6 GB, mostly browsers); its tag must match `@playwright/test` in
`apps/runner/package.json`.

---

## Project structure

```
apps/web/
  app/                 # routes + API
  components/          # shadcn/ui + layout/shared
  features/            # feature UI
  lib/                 # auth, prisma, permissions (app-specific)
  services/            # domain services (server-only)
  types/               # Prisma-shaped view models (+ re-exports from dto)
  prisma/
  utils/
packages/dto/
  src/enums.ts         # role / status values (shared)
  src/schemas.ts       # Zod request + query DTOs
  src/types.ts         # pure response DTOs (stats, import, ApiResult)
deploy/                # production host scripts
```

The rule that keeps this scalable: **route handlers and pages never touch
`prisma` directly.** They call a service in `services/`, which owns the queries
and the business rules. Services throw `HttpError`; `route()` in
[`apps/web/lib/api.ts`](apps/web/lib/api.ts) turns anything thrown into the right status code.

Shared **request/response contracts** belong in `@wetestcase/dto` so a second app
or client can depend on them without importing Next.js or Prisma.

---

## Design decisions worth knowing

**`TestCase.status` is denormalized.** The latest outcome is copied onto the test
case so the list can filter/sort by status and the dashboard can aggregate with a
single `groupBy`. It is written in the same transaction as the history row, and
only by `recordExecution` in
[`services/execution.service.ts`](services/execution.service.ts) — that is the
one place allowed to touch it.

**`TestCase.projectId` is denormalized too.** TC IDs are unique per *project*,
not per module, and every list and report query is project-scoped. Carrying the
id directly makes the unique constraint expressible and the queries cheap.

**Execution history is append-only.** Recording a result never updates a previous
row, because that history is the audit trail developers rely on.

**Screenshots are not in `/public`.** They are written under `UPLOAD_DIR` and
served through `/api/attachments/:id/file`, which requires a session. Uploads are
validated by magic number, not by the browser-supplied MIME type, and stored
under a generated UUID filename.

**`middleware.ts` is not authorization.** It only checks that a session cookie
exists, to keep the edge cheap. Every page re-validates via
`requireUser`/`requireRole`, and every API route via `route()`. `/api/*` is
excluded from the matcher so an unauthenticated fetch gets a JSON 401 instead of
an HTML redirect.

**`User.role` is a `String`, not a Prisma enum.** The Better Auth adapter writes
it through its generic additional-fields mechanism, which round-trips scalars
reliably. It is validated by `roleSchema` in
[`lib/validations.ts`](lib/validations.ts) at every entry point.

**Users are created through Better Auth's sign-up API**, never by inserting an
`Account` row — that is the only way the password hash matches what login
verifies. This applies to the admin "Add user" flow and the seed script alike.

**List state lives in the URL.** Filters, sort and pagination are query params, so
the server component refetches, and a filtered view is shareable and survives a
reload.

---

## Scripts

```bash
npm run dev          # dev server
npm run build        # prisma generate + next build (standalone)
npm run start        # serve the production build
npm run start:prod   # migrate then serve (bare-metal host)
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run db:migrate   # create/apply a migration
npm run db:push      # push the schema without a migration
npm run db:seed      # demo data
npm run db:studio    # Prisma Studio
npm run docker:stack:up   # manual rebuild/restart app only (does not touch tunnel)
npm run tunnel:free       # free Cloudflare URL — leave this terminal running
```

Mac mini: push to `main` deploys via GitHub Actions. Manual helpers remain
`npm run docker:stack:up`, `npm run tunnel:free`, `./deploy/scripts/backup-db.sh`
— see [deploy/README.md](deploy/README.md).

---

## Known limitations (Phase 1)

- **TC IDs sort lexicographically**, so `TC-10` precedes `TC-2`. Zero-pad
  (`TC-002`) for correct ordering — the usual convention anyway.
- **Attachments are stored on the local filesystem.** Fine for a single server;
  on an ephemeral or multi-instance host, point `UPLOAD_DIR` at a mounted volume
  or swap `services/attachment.service.ts` for object storage. The attachment
  row is the source of truth, so a missing file returns 404 rather than crashing.
- **No email transport.** Email verification and password reset are disabled;
  an Admin creates accounts and sets passwords.
- **No automated tests yet.** The type layer and validation are strict, but there
  is no test suite in Phase 1.
- **Import is capped** at 5,000 data rows and 10 MB per file.
