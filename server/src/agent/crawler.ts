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

async function attemptLogin(page: Page, username: string, password: string): Promise<boolean> {
  const userSelectors = [
    'input[type="email"]',
    'input[name*="user" i]',
    'input[name*="email" i]',
    'input[id*="user" i]',
    'input[id*="email" i]',
  ];
  const passSelectors = ['input[type="password"]'];

  let userField = null;
  for (const sel of userSelectors) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      userField = el;
      break;
    }
  }
  const passField = page.locator(passSelectors[0]).first();

  if (!userField || !(await passField.count())) return false;

  await userField.fill(username);
  await passField.fill(password);

  const submitBtn = page
    .locator('button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in")')
    .first();

  if (await submitBtn.count()) {
    await Promise.allSettled([page.waitForNavigation({ timeout: 8000 }), submitBtn.click()]);
  } else {
    await passField.press("Enter");
    await page.waitForTimeout(1500);
  }
  return true;
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
  const queue: { url: string; depth: number }[] = [{ url: opts.targetUrl, depth: 0 }];
  const modules: DetectedModule[] = [];
  let loggedIn = false;

  await page.goto(opts.targetUrl, { waitUntil: "domcontentloaded" });

  if (opts.username && opts.password) {
    try {
      loggedIn = await attemptLogin(page, opts.username, opts.password);
    } catch {
      loggedIn = false;
    }
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
          if (u.origin === origin && !visited.has(u.toString()) && !u.hash) {
            queue.push({ url: u.toString(), depth: depth + 1 });
          }
        } catch {
          // ignore malformed links
        }
      }
    }
  }

  return { modules, context, browser, loggedIn };
}
