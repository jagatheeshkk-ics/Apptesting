import { Browser, BrowserContext, Page, chromium } from "playwright";
import { DetectedField, DetectedModule, FieldType } from "../types.js";

export interface CrawlOptions {
  targetUrl: string;
  username?: string;
  password?: string;
  maxPages?: number;
  maxDepth?: number;
  onUsageEvent?: (event: {
    url: string;
    method: string;
    statusCode?: number;
    responseMs?: number;
    consoleError?: string;
  }) => void;
}

export interface CrawlResult {
  modules: DetectedModule[];
  context: BrowserContext;
  browser: Browser;
  loggedIn: boolean;
}

const INPUT_TYPE_MAP: Record<string, FieldType> = {
  text: "text",
  email: "email",
  password: "password",
  number: "number",
  tel: "tel",
  url: "url",
  date: "date",
  checkbox: "checkbox",
  radio: "radio",
};

function toFieldType(tag: string, inputType: string | null): FieldType {
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (inputType && INPUT_TYPE_MAP[inputType]) return INPUT_TYPE_MAP[inputType];
  return "other";
}

async function extractFieldsFromForm(page: Page, formSelector: string): Promise<DetectedField[]> {
  return page.$$eval(
    `${formSelector} input, ${formSelector} textarea, ${formSelector} select`,
    (els) =>
      els
        .filter((el) => {
          const type = (el as HTMLInputElement).type;
          return !["submit", "button", "hidden", "reset", "image", "file"].includes(type || "");
        })
        .map((el) => {
          const input = el as HTMLInputElement;
          const tag = el.tagName.toLowerCase();
          let label = "";
          const id = input.id;
          if (id) {
            const labelEl = document.querySelector(`label[for="${id}"]`);
            if (labelEl) label = labelEl.textContent?.trim() || "";
          }
          if (!label) {
            label = input.placeholder || input.getAttribute("aria-label") || "";
          }
          const options: string[] = [];
          if (tag === "select") {
            document
              .querySelectorAll(`#${CSS.escape(id || "")} option`)
              .forEach((o) => options.push((o as HTMLOptionElement).value));
          }
          return {
            name: input.name || input.id || label || "unnamed_field",
            label,
            tag,
            type: input.type || "",
            required: input.required || false,
            maxLength: input.maxLength > 0 ? input.maxLength : undefined,
            minLength: input.minLength > 0 ? input.minLength : undefined,
            min: input.min || undefined,
            max: input.max || undefined,
            pattern: input.pattern || undefined,
            options,
          };
        }),
  ).then((raw) =>
    raw.map(
      (f): DetectedField => ({
        name: f.name,
        label: f.label,
        type: toFieldType(f.tag, f.type || null),
        required: f.required,
        maxLength: f.maxLength,
        minLength: f.minLength,
        min: f.min ? Number(f.min) : undefined,
        max: f.max ? Number(f.max) : undefined,
        pattern: f.pattern,
        options: f.options?.length ? f.options : undefined,
      }),
    ),
  );
}

// Exported so other login-flow-aware code (loginBoundaryExecutor.ts) can
// drive the same two-step username -> submit -> password flow without
// duplicating these selectors.
//
// All scoped to :visible — some two-step login implementations keep both
// steps' fields/buttons in the DOM the whole time and just toggle CSS
// visibility rather than mounting/unmounting them, so a plain "does this
// selector match anything" check can't tell which step is actually on
// screen (a hidden step-two password field would look "present" before
// step one is even submitted, and filling/clicking a hidden element just
// hangs waiting for it to become visible). Restricting to :visible from the
// start means findField/clickSubmit only ever return something that's
// actually interactable right now, regardless of which of the two
// implementation styles the target app uses.
export const USER_FIELD_SELECTORS = [
  'input[type="email"]:visible',
  'input[name*="user" i]:visible',
  'input[name*="email" i]:visible',
  'input[name*="login" i]:visible',
  'input[id*="user" i]:visible',
  'input[id*="email" i]:visible',
  'input[id*="login" i]:visible',
];
export const PASSWORD_FIELD_SELECTOR = 'input[type="password"]:visible';
// Covers native form submission (button[type=submit]) plus common submit
// button labels for apps that handle the click in JS instead — "Proceed"
// and bare "Login" (no space) seen on a real staging login page prompted
// adding those here alongside the more common "Log in"/"Sign in"/"Next"/
// "Continue".
export const SUBMIT_SELECTOR =
  'button[type="submit"]:visible, input[type="submit"]:visible, button:visible:has-text("Log in"), button:visible:has-text("Login"), button:visible:has-text("Sign in"), button:visible:has-text("Next"), button:visible:has-text("Continue"), button:visible:has-text("Proceed"), button:visible:has-text("Submit"), button:visible:has-text("Enter")';

// Collapses URL variants that point at the same page (trailing slash,
// fragment) to one canonical string, so the same page reached via two
// differently-formatted links doesn't get crawled — and its modules
// discovered — twice.
function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

// "domcontentloaded" fires as soon as the initial HTML is parsed — for a
// client-rendered SPA (React/Angular/Vue etc.) that's often before the
// framework has mounted and actually put a <form> and its inputs into the
// DOM, so the crawler sees an empty shell and both field detection and
// login detection silently find nothing. A short best-effort wait for
// network activity to quiet down (most such apps fetch data/JS before
// rendering) gives the app a chance to finish rendering without blocking
// indefinitely on pages that poll in the background — swallow the timeout
// rather than fail the whole crawl over it.
async function settleAfterNavigation(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
}

export async function findField(page: Page, selectors: string[]) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count()) return el;
  }
  return null;
}

export async function clickSubmit(page: Page): Promise<boolean> {
  const btn = page.locator(SUBMIT_SELECTOR).first();
  if (!(await btn.count())) return false;
  await Promise.allSettled([page.waitForNavigation({ timeout: 8000 }), btn.click()]);
  return true;
}

// Handles both single-page logins (username + password together) and
// two-step logins (username -> Next/Continue -> password appears on the
// next screen, e.g. Microsoft/Google/many enterprise SSO-style flows).
async function attemptLogin(page: Page, username: string, password: string): Promise<boolean> {
  const url = page.url();
  const userField = await findField(page, USER_FIELD_SELECTORS);
  if (!userField) {
    console.error(
      `attemptLogin: no recognizable username/email field found on ${url} — the login form may use field names/attributes outside USER_FIELD_SELECTORS in crawler.ts.`,
    );
    return false;
  }
  await userField.fill(username);

  let passField = await findField(page, [PASSWORD_FIELD_SELECTOR]);
  if (!passField) {
    const advanced = await clickSubmit(page);
    if (!advanced) {
      console.error(
        `attemptLogin: filled the username field on ${url} but found no submit control to advance to the password step (checked SUBMIT_SELECTOR in crawler.ts).`,
      );
      return false;
    }
    await page.waitForTimeout(500);
    passField = await findField(page, [PASSWORD_FIELD_SELECTOR]);
    if (!passField) {
      console.error(`attemptLogin: advanced past the username step on ${url} but no password field appeared — not a login flow this agent can complete.`);
      return false; // still no password step — not a login flow we can complete
    }
  }

  await passField.fill(password);
  const submitted = await clickSubmit(page);
  if (!submitted) {
    await passField.press("Enter");
    await page.waitForTimeout(1500);
  }

  // A password field still present after submitting is a strong signal the
  // login was rejected (wrong credentials, or the form re-rendered with a
  // validation error) rather than actually succeeding — filling the fields
  // and clicking submit isn't proof of a real login, so don't report a
  // false positive that hides a failed login from the tester.
  const stillOnLoginForm = await findField(page, [PASSWORD_FIELD_SELECTOR]);
  if (stillOnLoginForm) {
    console.error(
      `attemptLogin: submitted credentials on ${url} but a password field is still present afterward (now at ${page.url()}) — the login was likely rejected. Double-check the username/password are correct.`,
    );
    return false;
  }
  return true;
}

// Used by the "New test run" page to decide whether to prompt for
// credentials: a real password field is the strongest signal, but a lone
// username/email/login-looking field (no more than a couple of other
// fields, e.g. a language picker) is the first step of a two-step login
// and should prompt just as eagerly, since the password field won't exist
// until that first step is submitted.
export function looksLikeLoginForm(fields: DetectedField[]): boolean {
  if (fields.some((f) => f.type === "password")) return true;
  const userLike = fields.some((f) => {
    if (f.type !== "text" && f.type !== "email") return false;
    const haystack = `${f.name} ${f.label ?? ""}`.toLowerCase();
    return /user|login|email|account/.test(haystack);
  });
  return userLike && fields.length <= 3;
}

// Extracts the login form on whatever page is currently loaded (the same
// per-form field extraction the main crawl loop uses for every page) and
// returns it as a module, or null if this page doesn't have a
// login-shaped form. Used to capture the login form *before* attemptLogin
// fills/submits it, since a successful login means the crawl loop below
// will never visit this URL to discover it the normal way.
async function extractLoginFormModule(page: Page, url: string): Promise<DetectedModule | null> {
  const title = await page.title().catch(() => url);
  const formSelectors = await page.$$eval("form", (forms) =>
    forms.map((f, i) => (f.id ? `#${CSS.escape(f.id)}` : `form:nth-of-type(${i + 1})`)),
  );
  for (const formSelector of formSelectors) {
    try {
      const fields = await extractFieldsFromForm(page, formSelector);
      if (fields.length && looksLikeLoginForm(fields)) {
        return { name: `${title} — form ${formSelector}`, url, type: "form", fields, formSelector };
      }
    } catch {
      // skip forms that fail to introspect
    }
  }
  return null;
}

export async function crawlAndIdentifyModules(opts: CrawlOptions): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 15;
  const maxDepth = opts.maxDepth ?? 2;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      opts.onUsageEvent?.({ url: page.url(), method: "CONSOLE", consoleError: msg.text() });
    }
  });

  const origin = new URL(opts.targetUrl).origin;
  const visited = new Set<string>();
  const modules: DetectedModule[] = [];
  let loggedIn = false;

  await page.goto(opts.targetUrl, { waitUntil: "domcontentloaded" });
  await settleAfterNavigation(page);

  // Captured *before* attemptLogin fills/submits the form (which mutates or
  // navigates away from it), so it's still available afterward if login
  // succeeds — see below for why that specific case needs it.
  let preLoginFormModule: DetectedModule | null = null;
  if (opts.username && opts.password) {
    preLoginFormModule = await extractLoginFormModule(page, opts.targetUrl);
    try {
      // attemptLogin logs the specific reason for any false result itself
      // (field not found, no submit control, still on the login form after
      // submitting, etc.) — nothing generic to add here.
      loggedIn = await attemptLogin(page, opts.username, opts.password);
    } catch (err) {
      loggedIn = false;
      console.error(`crawlAndIdentifyModules: login attempt on ${opts.targetUrl} threw`, err);
    }
  }

  // Start crawling from wherever we actually ended up (the authenticated
  // landing page after a successful login, or a same-URL redirect target)
  // rather than blindly re-fetching the original pre-login URL — otherwise
  // a successful login's navigation gets thrown away and the crawl
  // re-visits the anonymous login screen instead of what credentials were
  // supplied to reach.
  const queue: { url: string; depth: number }[] = [{ url: normalizeUrl(page.url()), depth: 0 }];

  // A successful login means the crawl above will never revisit the login
  // page's URL (it starts from the post-login landing page instead), so the
  // login form's own module — needed by generateLoginBoundaryTests, which
  // requires exactly this successful-login scenario to run its checks —
  // would otherwise never be recorded. On a failed login the crawl queue
  // above still starts at the (rejected) login page, so the normal per-page
  // loop below will capture it there instead; only add it here to avoid a
  // duplicate module for the same form.
  if (loggedIn && preLoginFormModule) {
    modules.push(preLoginFormModule);
  }

  while (queue.length && visited.size < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url) || depth > maxDepth) continue;
    visited.add(url);

    const start = Date.now();
    let statusCode: number | undefined;
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      statusCode = resp?.status();
      await settleAfterNavigation(page);
    } catch {
      opts.onUsageEvent?.({ url, method: "GET", statusCode: 0, responseMs: Date.now() - start });
      continue;
    }
    const responseMs = Date.now() - start;
    opts.onUsageEvent?.({ url, method: "GET", statusCode, responseMs });

    const title = await page.title().catch(() => url);
    modules.push({ name: title || url, url, type: "page", fields: [] });

    const formSelectors = await page.$$eval("form", (forms) =>
      forms.map((f, i) => f.id ? `#${CSS.escape(f.id)}` : `form:nth-of-type(${i + 1})`),
    );
    for (const formSelector of formSelectors) {
      try {
        const fields = await extractFieldsFromForm(page, formSelector);
        if (fields.length) {
          modules.push({
            name: `${title} — form ${formSelector}`,
            url,
            type: "form",
            fields,
            formSelector,
          });
        }
      } catch {
        // skip forms that fail to introspect
      }
    }

    if (depth < maxDepth) {
      const links = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
      for (const link of links) {
        try {
          const u = new URL(link);
          if (u.origin === origin && !u.hash) {
            const normalized = normalizeUrl(u.toString());
            if (!visited.has(normalized)) queue.push({ url: normalized, depth: depth + 1 });
          }
        } catch {
          // ignore malformed links
        }
      }
    }
  }

  return { modules, context, browser, loggedIn };
}
