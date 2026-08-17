# AppTesting Agent

An AI-agent-driven application testing platform. Give it a URL (and, optionally,
a login account), and the agent will:

1. **Analyze the URL, then name the module and describe what to test** — as
   soon as you enter a URL and move on, the agent crawls the application
   (purely to discover pages/forms/fields for the automated test types
   below, and to detect a login wall) and then asks for two things, both
   required:
   - **Module name** — the business module this URL belongs to (e.g.
     "Payroll", "CPF", "Attendance"), independent of whatever `<title>`s the
     crawler finds on the page. Typing in this field suggests names you've
     used before for this same URL, so repeat testing reuses the exact same
     name instead of fragmenting history with near-duplicates like "payroll"
     vs "Pay Roll".
   - **Test stories** — freeform text describing every scenario that needs
     testing at this URL/module (e.g. "Submitting a payroll amount for a
     valid employee ID should succeed and show a confirmation."). Leaving
     the module name field looks up the most recent test stories saved for
     that exact (URL, module name) pair and auto-fills them — an exact match
     on a name you chose, not a heuristic, so it's safe to do automatically
     with no opt-in toggle.
   - The AI (requires `GEMINI_API_KEY`) converts the test stories into
     executable browser flows — navigating, filling fields, clicking, and
     verifying the described outcome — with the same per-step pass/fail and
     screenshots as saved test flows. If a scenario turns out to reference a
     specific real value the AI can't invent (e.g. an actual employee ID or
     order number) that wasn't given in the stories text, the run records one
     clear error case naming exactly what's missing, rather than guessing —
     there's no separate pre-check step; add the detail to the stories text
     and re-run. Without `GEMINI_API_KEY` configured at all, the run instead
     records one clear error case explaining that the stories couldn't be
     processed, rather than silently skipping them.
   - If the URL turns out to be gated behind a login (a login form is found
     and no credentials were given), the page detects this and asks for that
     URL's credentials right there — "Re-analyze with these credentials"
     then crawls past the login page to discover the authenticated
     pages/forms too, instead of silently testing only the login page.
     Those credentials can be used for just that one run, or saved as a
     reusable login Account.
2. **Generate and execute test cases** across the testing pyramid — which
   categories run is your choice, via checkboxes (default: all of them):
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
   - **Custom test stories** — the required "Test stories" text described in
     step 1 above, converted into executable browser flows.

   *Not included:* unit testing doesn't fit this architecture — the platform
   only ever sees a target URL from the outside, so there's no source/function
   boundary to unit-test.
3. **Execute every case** with a real browser (Playwright) or, for stress
   tests, concurrent HTTP requests — capturing a screenshot and
   timing/observed-behavior evidence for each one.
4. **Produce a detailed HTML test report** per run, with embedded screenshots
   and a regression summary. Every test case shows its **type** (positive —
   valid input/normal usage, or negative — invalid/malicious input expected
   to be rejected), its **expected result**, and its **actual result** side
   by side, on the run detail page, the downloadable report, and the
   Reports page's cross-run search. The report header also names the
   **module(s)** covered, **who ran it** (the signed-in platform user, when
   auth is enabled), and the **test types actually selected** ("Full" only
   if every category was included, otherwise the specific types picked).
   Boundary tests also detect redirect-loop pages (URL changes but the
   destination reads identically to the starting page — e.g. a maintenance
   or expired-session bounce) and flag those as an error needing manual
   review instead of a misleading pass/fail. Both the per-run report and
   the Reports page are also **downloadable as an Excel workbook**, not
   just HTML.
5. **Track KPIs** across multiple login accounts: test execution KPIs (pass
   rate, vulnerabilities/accessibility/performance issues found), application
   usage/behavior KPIs (response times, errors, latency under load), and
   agent performance KPIs (run duration, flow pass rate, findings over time).
   The **KPI dashboard**'s Overview panel gives a filterable summary: total
   test runs/cases, pass rate, and total issues found, broken down by test
   type (smoke/boundary/vulnerability/stress/performance/compatibility/
   accessibility/flow) and by day or week — filterable by Project, by
   Account (the "user" whose login was used for the run), and by date range.
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
  account, in `full` or `quick` (sanity) mode. `enabledCategoriesJson` records
  which test-type checkboxes were selected on the New Test Run page (`null`
  means all categories — the default). Carries a `regressionsJson` diff
  against the previous run for the same target.
- `Module` — a page or form discovered during the crawl. `userStoriesJson`
  holds its editable, plain-language user stories — auto-drafted when you
  analyze a URL on the New Test Run page, then whatever you edited them to
  before starting the run (or freshly auto-drafted at run time if you skipped
  the analyze step for that module).
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
  described below. `roleId` optionally links to a `Role`.
- `Role` — a role master: a named set of dashboard pages (`allowedPagesJson`)
  a user with that role may see. A user with no role keeps full,
  unrestricted access — assigning a role is a purely additive restriction.

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

Session lifetime, once signed in:
- **30-minute idle timeout.** The session cookie carries a 30-minute
  expiry that's refreshed on every authenticated request (server side,
  `server/src/auth/gate.ts`), and the dashboard independently starts its
  own 30-minute timer on mount that resets on mouse/keyboard/touch/scroll
  activity (`web/src/App.tsx`) — so 30 minutes with no activity signs the
  user out and returns them to the login screen with an explanatory
  message, even if a background poll (e.g. a running test's status check)
  would otherwise have kept the server-side session alive.
- **Signed out on browser close.** The session cookie has no `Max-Age` —
  it's a browser-session cookie, so fully closing the browser (not just
  the tab) drops it, and the next visit needs a fresh login regardless of
  the 30-minute window.

Required when `AUTH_ENABLED=true`:
- `AUTH_SECRET` — a long random string used to sign session cookies. The
  server refuses to start with `AUTH_ENABLED=true` and no `AUTH_SECRET`.
- `SMTP_HOST` (+ `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) — if
  unset, the verification code is logged to the server console instead of
  emailed, so you can test the flow before wiring up real SMTP.

### Role-based page access

On the **Roles** page, define a role as a name plus a checklist of which
dashboard pages it can see (New test run, Test runs, Projects, Accounts,
Flows, Users, Roles, Reports, KPI dashboard). Assign a role to a user on
the **Users** page — a user with no role keeps full, unrestricted access,
so this is opt-in per user, not a default lockdown.

This gates the dashboard's own pages (what a logged-in user can see), not
the QA "Project Modules" you define under a Project. Enforcement happens
in both the nav/routes (hidden/blocked pages) and the API (`server/src/auth/gate.ts`)
— except the plain list endpoints (`GET /api/accounts`, `GET /api/projects`,
`GET /api/roles`), which stay available to any authenticated user
regardless of role, since several pages depend on those lists purely to
populate dropdowns (New test run/Accounts/Flows need accounts+projects;
Users needs roles for its role picker); restricting them would break
those dropdowns for users permitted on the page using the dropdown but
not on the page that owns that data. Mutations on those same resources
(create/edit/delete) stay gated as normal.

### AI-generated user stories and custom test stories

Set `GEMINI_API_KEY` (a free API key from [Google AI Studio](https://aistudio.google.com/apikey))
to have the New Test Run page's user-story drafts written by Gemini
instead of the built-in templates, and to enable the **custom test
stories** textarea (free-text QA scenarios converted into executable
flows — see point 2 above). Without a key, story drafting still works —
it just uses the simpler templates in `server/src/agent/userStoryGenerator.ts`
— and custom test stories record a single clear error case explaining
that the AI isn't configured, instead of silently doing nothing.

The model ID is centralized in `server/src/agent/geminiModel.ts` and
defaults to `gemini-flash-latest`; override it with the `GEMINI_MODEL` env
var if Google deprecates/renames it again (server logs will show a
`... is no longer available` error naming the exact problem — no code
change needed, just set the env var and redeploy). Either way, user
stories are fully editable before you start a run, and every AI call has a
timeout and falls back cleanly on any error (bad key, network issue,
malformed response, deprecated model) — all now logged via
`console.error` so failures are diagnosable in Render's logs instead of
failing silently.

Google's free tier caps requests at a handful per minute, so per-module
story generation (both the New Test Run page's auto-analyze preview and
the actual run) dispatches its Gemini calls one at a time rather than all
at once, and a `429` (rate limited) gets one retry after honoring Google's
suggested wait — both meant to keep a target with many pages/forms from
blowing through the quota in one burst. Persistent `429`s past that point
still fall back cleanly (heuristic templates for user stories; a single
clear error case for custom test stories) rather than failing the run.

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

### Run speed

Test cases (and flows) within a run execute concurrently — by default 4 at a
time, each in its own browser tab sharing the crawl's logged-in session —
instead of one at a time. Set `TEST_EXECUTION_CONCURRENCY` in `server/.env`
to change this: lower it (e.g. `1`) on a memory-constrained host or if the
target app doesn't tolerate concurrent requests well (some apps enforce a
single active session, or invalidate CSRF tokens on each page load, which
can turn concurrent execution into false failures); raise it if the host has
room and you want runs to finish faster.

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
