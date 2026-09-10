import { randomUUID } from "node:crypto";
import path from "node:path";
import { Page } from "playwright";
import { DetectedField, DetectedModule, ExecutedResult, GeneratedTestCase } from "../types.js";

export const SQL_ERROR_PATTERNS = [
  /sql syntax/i,
  /mysql_fetch/i,
  /ora-\d{5}/i,
  /sqlite3\.OperationalError/i,
  /pg_query/i,
  /unclosed quotation mark/i,
  /sqlstate/i,
];

const XSS_PATTERNS = [/<script>alert\(1\)<\/script>/, /<svg\/onload=alert\(1\)>/, /<img src=x onerror=alert\(1\)>/];

export function defaultValueFor(field: DetectedField): string {
  switch (field.type) {
    case "email":
      return "test.user@example.com";
    case "password":
      return "TestPass123!";
    case "number":
      return String(field.min ?? 1);
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "tel":
      return "5551234567";
    case "url":
      return "https://example.com";
    case "textarea":
      return "Sample test content.";
    default:
      return "Test Value";
  }
}

async function fillForm(
  page: Page,
  module: DetectedModule,
  overrides: Record<string, string> = {},
): Promise<void> {
  for (const field of module.fields) {
    if (field.type === "checkbox" || field.type === "radio" || field.type === "select") continue;
    const value = overrides[field.name] ?? defaultValueFor(field);
    try {
      const locator = page.locator(`input[name="${field.name}"], textarea[name="${field.name}"]`).first();
      if (await locator.count()) {
        await locator.fill(value, { timeout: 3000 });
      }
    } catch {
      // some fields may not be directly fillable (e.g. custom widgets) — skip
    }
  }
}

async function submitForm(page: Page, module: DetectedModule): Promise<void> {
  const scope = module.formSelector ? page.locator(module.formSelector) : page;
  const submit = scope
    .locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Save")')
    .first();
  try {
    if (await submit.count()) {
      await Promise.allSettled([page.waitForNavigation({ timeout: 5000 }), submit.click()]);
    } else {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);
    }
  } catch {
    // navigation may not occur for SPA forms — that's fine
  }
}

export async function executeSmokeCase(
  page: Page,
  testCase: GeneratedTestCase,
  module: DetectedModule,
  screenshotDir: string,
): Promise<ExecutedResult> {
  const start = Date.now();
  const consoleErrors: string[] = [];
  const listener = (msg: any) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  };
  page.on("console", listener);

  let status = "pass";
  let actual = "";
  try {
    const resp = await page.goto(module.url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const code = resp?.status() ?? 0;
    await page.waitForTimeout(500);

    if (testCase.name.startsWith("Form renders")) {
      const visibleCount = await page
        .locator(`${module.formSelector ?? "form"} input, ${module.formSelector ?? "form"} textarea, ${module.formSelector ?? "form"} select`)
        .count();
      actual = `${visibleCount}/${module.fields.length} fields present in DOM.`;
      status = visibleCount >= module.fields.length ? "pass" : "fail";
    } else {
      actual = `HTTP ${code}. Console errors: ${consoleErrors.length}.`;
      status = code >= 200 && code < 400 ? "pass" : "fail";
      if (consoleErrors.length > 0) status = "fail";
    }
  } catch (err) {
    status = "error";
    actual = `Navigation failed: ${(err as Error).message}`;
  } finally {
    page.off("console", listener);
  }

  const screenshotPath = await captureScreenshot(page, screenshotDir);
  return { status: status as ExecutedResult["status"], actual, screenshotPath, durationMs: Date.now() - start };
}

function normalizePageText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

async function readPageText(page: Page): Promise<string> {
  return normalizePageText(await page.evaluate(() => document.body.innerText).catch(() => ""));
}

export async function executeBoundaryCase(
  page: Page,
  testCase: GeneratedTestCase,
  module: DetectedModule,
  screenshotDir: string,
): Promise<ExecutedResult> {
  const start = Date.now();
  let status: ExecutedResult["status"] = "pass";
  let actual = "";

  try {
    await page.goto(module.url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const beforeUrl = page.url();
    const beforeContent = await readPageText(page);
    await fillForm(page, module, testCase.input ?? {});
    await submitForm(page, module);
    await page.waitForTimeout(500);
    const afterUrl = page.url();
    const navigated = beforeUrl !== afterUrl;
    const afterContent = await readPageText(page);

    // The URL changed, but the destination page reads identically to the
    // page we started on — most likely a redirect loop back to the same
    // screen (maintenance page, expired session, login bounce) rather than
    // a genuine accept/reject outcome. Treating that as pass/fail would be
    // misleading, so flag it for manual review instead.
    const redirectLoop = navigated && !!beforeContent && beforeContent === afterContent;

    const expectsRejection = /rejected|validation error/i.test(testCase.expectation);
    if (redirectLoop) {
      status = "error";
      actual =
        "URL changed after submission, but the resulting page's content is identical to the page shown before submitting — this looks like a redirect loop back to the same screen (e.g. a maintenance page or an expired/invalid session) rather than a real accept/reject outcome. Verify manually.";
    } else if (expectsRejection) {
      status = navigated ? "fail" : "pass";
      actual = navigated
        ? "Form navigated away (submission appears to have been accepted) despite input expected to be rejected — verify manually."
        : "Form did not navigate away, consistent with client/server-side validation rejecting the input.";
    } else {
      status = navigated ? "pass" : "fail";
      actual = navigated
        ? "Form submitted successfully as expected for valid boundary input."
        : "Form did not navigate away for input expected to be accepted — verify manually.";
    }
  } catch (err) {
    status = "error";
    actual = `Execution error: ${(err as Error).message}`;
  }

  const screenshotPath = await captureScreenshot(page, screenshotDir);
  return { status, actual, screenshotPath, durationMs: Date.now() - start };
}

export async function executeVulnerabilityCase(
  page: Page,
  testCase: GeneratedTestCase,
  module: DetectedModule,
  screenshotDir: string,
): Promise<ExecutedResult> {
  const start = Date.now();
  let status: ExecutedResult["status"] = "pass";
  let severity: ExecutedResult["severity"] = "info";
  let actual = "";
  let dialogFired = false;

  const dialogListener = async (dialog: import("playwright").Dialog) => {
    dialogFired = true;
    await dialog.dismiss().catch(() => {});
  };
  page.on("dialog", dialogListener);

  try {
    if (testCase.name.includes("security headers")) {
      const resp = await page.goto(module.url, { waitUntil: "domcontentloaded", timeout: 15000 });
      const headers = resp?.headers() ?? {};
      const missing: string[] = [];
      for (const h of ["content-security-policy", "x-frame-options", "x-content-type-options", "strict-transport-security"]) {
        if (!headers[h]) missing.push(h);
      }
      if (missing.length) {
        status = "fail";
        severity = missing.length >= 3 ? "medium" : "low";
        actual = `Missing security headers: ${missing.join(", ")}.`;
      } else {
        actual = "All checked security headers present.";
      }
    } else {
      await page.goto(module.url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await fillForm(page, module, testCase.input ?? {});
      await submitForm(page, module);
      await page.waitForTimeout(500);

      const content = await page.content();
      const payloadValue = testCase.input ? Object.values(testCase.input)[0] : "";

      if (dialogFired) {
        status = "fail";
        severity = "critical";
        actual = "A JavaScript dialog fired after submitting the XSS payload — indicates unsanitized script execution.";
      } else if (payloadValue && XSS_PATTERNS.some((p) => p.test(content))) {
        status = "fail";
        severity = "high";
        actual = "Raw XSS payload was reflected unescaped in the page HTML.";
      } else if (SQL_ERROR_PATTERNS.some((p) => p.test(content))) {
        status = "fail";
        severity = "high";
        actual = "A database error message was reflected in the response, indicating possible SQL injection.";
      } else if (/root:.*:0:0:/.test(content)) {
        status = "fail";
        severity = "critical";
        actual = "System file contents appear to have been disclosed (path traversal).";
      } else {
        actual = "Payload was not reflected/executed; no known vulnerability signature detected. Manual review still recommended.";
      }
    }
  } catch (err) {
    status = "error";
    actual = `Execution error: ${(err as Error).message}`;
  } finally {
    page.off("dialog", dialogListener);
  }

  const screenshotPath = await captureScreenshot(page, screenshotDir);
  return { status, severity, actual, screenshotPath, durationMs: Date.now() - start };
}

export async function captureScreenshot(page: Page, screenshotDir: string): Promise<string> {
  const filename = `${randomUUID()}.png`;
  const filePath = path.join(screenshotDir, filename);
  await page.screenshot({ path: filePath, fullPage: true }).catch(() => {});
  return filename;
}
