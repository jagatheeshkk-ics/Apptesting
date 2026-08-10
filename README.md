# AppTesting Agent

An AI-agent-driven application testing platform. Give it a URL (and, optionally,
a login account), and the agent will:

1. **Crawl the target application** and identify modules — pages, forms, and
   input fields (with their type/length/range constraints).
2. **Generate test cases** automatically:
   - **Smoke tests** — pages load, forms render with all expected fields.
   - **Boundary value tests** — empty/whitespace, min/max length, min/max
     numeric range, overflow, unicode, special characters, per detected field.
   - **Vulnerability tests** — reflected XSS, SQL injection, path traversal,
     template injection, and missing security headers (non-destructive
     payloads only, intended for applications you own or are authorized to test).
3. **Execute every case** with a real browser (Playwright), capturing a
   screenshot and timing/observed-behavior evidence for each one.
4. **Produce a detailed HTML test report** per run, with embedded screenshots.
5. **Track KPIs** across multiple login accounts: test execution KPIs
   (pass rate, vulnerabilities found), application usage/behavior KPIs
   (response times, errors encountered), and agent performance KPIs (run
   duration, vulnerabilities over time).

Stress testing and deeper LLM-driven module classification are natural
next phases on top of this foundation.

## Project layout

```
server/   Fastify + Prisma (SQLite) API and the testing agent (Playwright)
web/      React + Vite dashboard
```

## Data model

- `Account` — a login account the agent can use against a target app (label,
  URL, username/password, role). **Use dedicated test/QA credentials only** —
  passwords are stored so the agent can resubmit them into login forms.
- `TestRun` — one agent run against a target URL, optionally as a given account.
- `Module` — a page or form discovered during the crawl.
- `TestCase` / `TestResult` — a generated case and its executed outcome
  (pass/fail/error, severity for vulnerabilities, screenshot, duration).
- `UsageEvent` — per-request timing/errors captured during the run, used for
  the application usage KPIs.

## Running locally

Requires Node 20+.

```bash
npm install

# server: generate the Prisma client and create the local SQLite DB
cp server/.env.example server/.env
npm run prisma:generate -w server
npm run prisma:push -w server

# terminal 1
npm run dev:server   # http://localhost:4000

# terminal 2
npm run dev:web      # http://localhost:5173
```

Open the dashboard, add a login account (optional), and start a test run
with a target URL. Runs, results, screenshots, generated reports, and the
KPI dashboard are all available from the sidebar.

If Playwright's bundled Chromium isn't installed in your environment, either
run `npx playwright install chromium` inside `server/`, or point
`CHROMIUM_EXECUTABLE_PATH` in `server/.env` at an existing Chromium/Chrome
binary.

## Security note

The vulnerability test generator sends non-destructive payloads (reflected
XSS/SQLi/path-traversal probes, security header checks) intended for
authorized testing of applications you own or have permission to test. It
does not attempt data destruction, denial of service, or any form of
persistence.
