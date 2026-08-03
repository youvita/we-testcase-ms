# TestCase MS — Online Test Case Management (Phase 1)

A web-based test case management system that replaces Excel-based test execution
while letting teams keep using their existing Excel templates.

QA imports a spreadsheet, executes the cases online, and developers get a live
read-only view of what is failing. Nobody edits a shared `.xlsx` mid-cycle again.

This is **not** a bug tracker and **not** an AI testing platform.

---

## Stack

| Layer      | Choice                                        |
| ---------- | --------------------------------------------- |
| Framework  | Next.js 15 (App Router) + React 19            |
| Language   | TypeScript (`strict`, `noUncheckedIndexedAccess`) |
| Styling    | Tailwind CSS v3 + shadcn/ui (new-york)        |
| Database   | PostgreSQL via Prisma 6                       |
| Auth       | Better Auth (email + password)                |
| Excel      | SheetJS (`xlsx`)                              |
| PDF        | `pdf-lib`                                     |
| Charts     | Recharts                                      |
| Validation | Zod + react-hook-form                         |

---

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
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

## Project structure

```
app/
  (auth)/            login, register — split layout
  (app)/             authenticated shell (sidebar + top nav)
    dashboard/
    projects/[projectId]/
      test-cases/[testCaseId]/    detail + execution panel
      failed/                     developer read-only view
    admin/users/
  api/               route handlers
components/
  ui/                shadcn/ui primitives
  layout/            sidebar, mobile nav, breadcrumbs, user menu
  shared/            badges, stat cards, empty states, pagination
features/            feature-scoped components (auth, projects, modules,
                     test-cases, executions, dashboard, reports, users)
hooks/               use-debounce, use-query-params
lib/                 auth, prisma, session, permissions, validations, api
prisma/              schema.prisma, seed.ts
services/            data access + business logic (server-only)
types/               shared domain types
utils/               excel parsing, formatting, stats, api client
```

The rule that keeps this scalable: **route handlers and pages never touch
`prisma` directly.** They call a service in `services/`, which owns the queries
and the business rules. Services throw `HttpError`; `route()` in
[`lib/api.ts`](lib/api.ts) turns anything thrown into the right status code.

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
npm run build        # prisma generate + next build
npm run start        # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run db:migrate   # create/apply a migration
npm run db:push      # push the schema without a migration
npm run db:seed      # demo data
npm run db:studio    # Prisma Studio
```

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
