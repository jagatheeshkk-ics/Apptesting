# AppTesting Agent

An AI-agent-driven application testing platform. Give it a URL (and, optionally,
a login account), and the agent will:

1. **Crawl the target application** and identify modules — pages, forms, and
   input fields (with their type/length/range constraints).
2. **Generate and execute test cases** across the testing pyramid:
   - **Smoke** — pages load, forms render with all expected fields.
   - **Boundary value / negative** — empty/whitespace, min/max length, min/max
     numeric range, overflow, unicode, special characters, per detected field.
   - **Vulnerability (security)** — reflected XSS, SQL injection, path
     traversal, template injection, missing security headers (non-destructive
     payloads only, for applications you own or are authorized to test).
   - **Load & stress** — N concurrent requests against each page and form
     submission, measuring error rate and latency percentiles.
   - **Performance** — navigation timing (DOMContentLoaded/load) and page
     weight (resource count/transfer size) against thresholds.
   - **Compatibility** — renders every page at mobile/tablet/desktop
     viewports and flags horizontal overflow or console errors.
   - **Accessibility** (folds in basic usability heuristics) — missing alt
     text, unlabeled form controls, missing document language/title,
     unlabeled interactive elements.
   - **Regression** — after each run, diffs results against the most recent
     prior completed run for the same target/account and flags anything
     that flipped pass→fail (or got fixed).
   - **Sanity / quick mode** — an alternate run mode that only re-runs smoke
     tests plus whatever specific cases failed last time, instead of the
     full suite.
   - **Integration / system / functional / UAT — via test flows** — define a
     named multi-step journey (e.g. login → add to cart → checkout → expect
     confirmation) once; it then runs automatically as part of any test run
     against a matching target URL, with per-step pass/fail and screenshots.

   *Not included:* unit testing doesn't fit this architecture — the platform
   only ever sees a target URL from the outside, so there's no source/function
   boundary to unit-test.
3. **Execute every case** with a real browser (Playwright) or, for stress
   tests, concurrent HTTP requests — capturing a screenshot and
   timing/observed-behavior evidence for each one.
4. **Produce a detailed HTML test report** per run, with embedded screenshots
   and a regression summary.
5. **Track KPIs** across multiple login accounts: test execution KPIs (pass
   rate, vulnerabilities/accessibility/performance issues found), application
   usage/behavior KPIs (response times, errors, latency under load), and
   agent performance KPIs (run duration, flow pass rate, findings over time).
6. **Search test case results for a report** — filter across every run's test
   cases by date range and by module (pick one module or several), on the
   **Reports** dashboard page. Results show a pass/fail/error summary and can
   be downloaded as a self-contained HTML report.

## Project layout

```
server/   Fastify + Prisma (Supabase Postgres) API and the testing agent (Playwright)
web/      React + Vite dashboard
```

## Data model

- `Project` / `ProjectModule` — the project master. A `Project` is the
  application/product under test; `ProjectModule` is its master list of
  named modules (e.g. "Login", "Checkout"). `Account`, `TestRun`, and
  `TestFlow` each optionally link to a `Project` (a test run inherits its
  account's project if none is given explicitly), so every test case run
  under a project rolls up into consolidated, project-wise counts on the
  **Projects** dashboard page — broken down further by the (crawl-
  discovered) module each case belongs to. Runs with no project attached
  are grouped under an "Unassigned" bucket so nothing is left out of the
  consolidated totals.
- `Account` — a login account the agent can use against a target app (label,
  URL, username/password, role). **Use dedicated test/QA credentials only** —
  passwords are stored so the agent can resubmit them into login forms.
- `TestRun` — one agent run against a target URL, optionally as a given
  account, in `full` or `quick` (sanity) mode. Carries a `regressionsJson`
  diff against the previous run for the same target.
- `Module` — a page or form discovered during the crawl.
- `TestCase` / `TestResult` — a generated case and its executed outcome
  (pass/fail/error, severity, screenshot, duration).
- `StressMetric` / `PerformanceMetric` — concurrency/latency and page-weight
  metrics attached 1:1 to a stress/performance `TestCase`.
- `TestFlow` / `FlowStep` / `FlowStepResult` — a user-authored multi-step
  journey and its per-step execution outcomes.
- `UsageEvent` — per-request timing/errors captured during the run, used for
  the application usage KPIs.
- `User` — a dashboard user directory (add/edit/delete), separate from
  `Account`. Passwords are hashed (scrypt) and never returned by the API.
  `email` is required and unique — it's the login identifier. `emailVerifiedAt`
  and the `verificationCode*` fields track the one-time email verification
  described below.

## Login & email verification

Dashboard login is gated behind the `AUTH_ENABLED` env var (**off by
default** — the dashboard behaves exactly as before until you turn it on).

- **Off** (`AUTH_ENABLED` unset or not `"true"`): no login required, same as
  before this feature existed.
- **On**: every `/api/*` route except `/api/auth/*` and `/api/health`
  requires a valid session cookie.

Flow once enabled:
1. An admin creates a user on the **Users** page (email + an initial
   password).
2. That user's *first* login (`POST /api/auth/login` with email + password)
   validates the password but doesn't sign them in yet — it emails a 6-digit
   code (15 min expiry) and the UI prompts for it (`POST
   /api/auth/verify-email`).
3. Every login after that first successful verification is just email +
   password — no extra step.

Required when `AUTH_ENABLED=true`:
- `AUTH_SECRET` — a long random string used to sign session cookies. The
  server refuses to start with `AUTH_ENABLED=true` and no `AUTH_SECRET`.
- `SMTP_HOST` (+ `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) — if
  unset, the verification code is logged to the server console instead of
  emailed, so you can test the flow before wiring up real SMTP.

## Database (Supabase)

Data is stored in a Supabase Postgres database via Prisma. To set one up:

1. Create a project at [supabase.com](https://supabase.com) (the free tier works fine).
2. In **Project Settings → Database**, copy the **Connection string** in both
   pooled (Transaction mode, port 6543) and direct (Session mode, port 5432)
   forms.
3. Put them in `server/.env` as `DATABASE_URL` (pooled) and `DIRECT_URL`
   (direct) — see `server/.env.example` for the exact shape. The pooled URL
   is what the app uses at runtime; the direct URL is only used by Prisma
   when running migrations (PgBouncer's pooling doesn't support the prepared
   statements migrations rely on).
4. Run the migration to create the tables (see below).

## Running locally

Requires Node 20+ and a Supabase project (see above).

```bash
npm install

cp server/.env.example server/.env
# edit server/.env with your Supabase DATABASE_URL / DIRECT_URL

npm run prisma:generate -w server
npm run prisma:migrate -w server   # creates the tables in your Supabase DB

# terminal 1
npm run dev:server   # http://localhost:4000

# terminal 2
npm run dev:web      # http://localhost:5173
```

Open the dashboard: add a login account (optional), optionally define a test
flow for a critical journey, and start a test run with a target URL. Runs,
results, screenshots, generated reports, and the KPI dashboard are all
available from the sidebar.

If Playwright's bundled Chromium isn't installed in your environment, either
run `npx playwright install chromium` inside `server/`, or point
`CHROMIUM_EXECUTABLE_PATH` in `server/.env` at an existing Chromium/Chrome
binary.

## Deploying to production (Render)

The `Dockerfile` builds a single image that runs the Fastify API and also
serves the built dashboard (`web/dist`) from the same process — one URL,
one service, no CORS/cross-origin cookie issues for login. The image is
based on `mcr.microsoft.com/playwright:v1.62.1-noble`, which ships Chromium
and all its system libraries preinstalled — keep that tag and the
`playwright` version pinned in `server/package.json` in sync if you ever
bump it.

1. In the [Render dashboard](https://dashboard.render.com), **New → Blueprint**
   and point it at this repo. Render reads `render.yaml` at the repo root
   and proposes one Docker web service.
2. Fill in the secrets it prompts for (marked `sync: false` in
   `render.yaml`): `DATABASE_URL` / `DIRECT_URL` (your Supabase pooled/direct
   connection strings — see below) and, only if/when you're turning login
   on, the `SMTP_*` vars. `AUTH_SECRET` is auto-generated by Render; you
   don't need to supply it.
3. Apply. Render builds the Docker image and deploys it; `/api/health` is
   the health check path.
4. Before (or right after) the first deploy, run the Prisma migrations
   against your Supabase database from your own machine — Render's build
   step doesn't do this for you (see "Running locally" above for the
   `prisma migrate dev` step, or use `prisma migrate deploy` for a
   production rollout).

**Sizing**: Chromium is memory-hungry and a full test run holds a browser
open for a while, so Render's free tier (512MB, spins down on idle) can
OOM or get killed mid-run. `render.yaml` defaults to the `starter` plan —
adjust in the Render dashboard if you need more headroom.

**Login stays off** (`AUTH_ENABLED=false`) until you explicitly flip it in
Render's environment variables — see "Login & email verification" above.
Nothing about deploying to Render changes that default.

## Security note

The vulnerability test generator sends non-destructive payloads (reflected
XSS/SQLi/path-traversal probes, security header checks) intended for
authorized testing of applications you own or have permission to test. It
does not attempt data destruction, denial of service, or any form of
persistence.
