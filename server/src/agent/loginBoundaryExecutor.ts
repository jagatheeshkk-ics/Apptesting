import { Page } from "playwright";
import { DetectedModule, ExecutedResult, GeneratedTestCase } from "../types.js";
import { captureScreenshot, SQL_ERROR_PATTERNS } from "./executor.js";
import { PASSWORD_FIELD_SELECTOR, SUBMIT_SELECTOR, USER_FIELD_SELECTORS, clickSubmit, findField } from "./crawler.js";

// Unlike crawler.ts's attemptLogin (called once per crawl, right after a
// fresh page.goto), this executor runs several of these checks back-to-back
// on the *same* page without a full navigation between them — but that's
// safe because USER_FIELD_SELECTORS/PASSWORD_FIELD_SELECTOR/SUBMIT_SELECTOR
// (and therefore findField/clickSubmit) are already scoped to :visible, so
// each step's interactions stay correctly scoped to whichever step is
// actually on screen regardless of how many times this runs on one page.

// Best-effort re-login with the real credentials after a check that
// necessarily submits a wrong password (the padded-password check below) —
// mirrors the source BVA suite's own restore step, so an automated run
// doesn't quietly leave the real account sitting on a failed attempt with
// nothing to reset its lockout counter before the next scheduled run.
async function reattemptRealLogin(page: Page, loginUrl: string, username: string, password: string): Promise<boolean> {
  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    const userField = await findField(page, USER_FIELD_SELECTORS);
    if (!userField) return true; // no login form here (anymore) — nothing to restore
    await userField.fill(username);
    let passField = await findField(page, [PASSWORD_FIELD_SELECTOR]);
    if (!passField) {
      await clickSubmit(page);
      await page.waitForTimeout(500);
      passField = await findField(page, [PASSWORD_FIELD_SELECTOR]);
      if (!passField) return false;
    }
    await passField.fill(password);
    await clickSubmit(page);
    await page.waitForTimeout(1000);
    return !(await findField(page, [PASSWORD_FIELD_SELECTOR]));
  } catch {
    return false;
  }
}

export async function executeLoginBoundaryCase(
  page: Page,
  testCase: GeneratedTestCase,
  module: DetectedModule,
  screenshotDir: string,
): Promise<ExecutedResult> {
  const start = Date.now();
  let status: ExecutedResult["status"] = "pass";
  let actual = "";
  const username = testCase.input?.username ?? "";
  const password = testCase.input?.password;

  try {
    await page.goto(module.url, { waitUntil: "domcontentloaded", timeout: 15000 });

    const userField = await findField(page, USER_FIELD_SELECTORS);
    if (!userField) {
      const screenshotPath = await captureScreenshot(page, screenshotDir);
      return {
        status: "error",
        actual: "Could not find a username/email field on the login page to run this check.",
        screenshotPath,
        durationMs: Date.now() - start,
      };
    }
    await userField.fill(username);

    const proceedBtn = page.locator(SUBMIT_SELECTOR).first();
    const proceedDisabled = (await proceedBtn.count()) > 0 && (await proceedBtn.isDisabled().catch(() => false));
    if (!proceedDisabled) {
      await clickSubmit(page);
      await page.waitForTimeout(500);
    }

    const content = await page.content();
    const passField = await findField(page, [PASSWORD_FIELD_SELECTOR]);

    if (testCase.name.includes("empty username") || testCase.name.includes("whitespace-only username")) {
      const blocked = proceedDisabled || !passField;
      status = blocked ? "pass" : "fail";
      actual = blocked
        ? "Proceeding past the username step was blocked, as expected for empty/whitespace-only input."
        : "The form advanced to the password step despite empty/whitespace-only username input.";
    } else if (testCase.name.includes("SQL injection")) {
      const leaked = SQL_ERROR_PATTERNS.some((p) => p.test(content));
      const blocked = proceedDisabled || !passField;
      status = leaked ? "fail" : blocked ? "pass" : "fail";
      actual = leaked
        ? "A database error message was reflected after submitting a SQL injection payload in the username field."
        : blocked
          ? "The SQL injection payload was rejected without advancing to the password step or leaking a database error."
          : "The form advanced to the password step after a SQL injection payload was submitted as the username — verify manually.";
    } else if (testCase.name.includes("XSS payload")) {
      const reflected = content.includes("<script>alert(1)</script>");
      status = reflected ? "fail" : "pass";
      actual = reflected
        ? "The raw script payload was reflected unescaped in the page HTML."
        : "The script payload was not reflected unescaped in the page.";
    } else if (testCase.name.includes("unicode username")) {
      status = "pass";
      actual = passField
        ? "Unicode username advanced to the password step without crashing the page."
        : "Unicode username did not advance to the password step, but the page did not crash — treated as graceful handling.";
    } else if (testCase.name.includes("trimmed and accepted") || testCase.name.includes("case-insensitive")) {
      if (!passField) {
        status = "fail";
        actual =
          "Expected to reach the password step with a valid username (trimmed or case-varied), but the password field never appeared.";
      } else if (!password) {
        status = "error";
        actual = "No password was available to complete this check.";
      } else {
        await passField.fill(password);
        await clickSubmit(page);
        await page.waitForTimeout(1000);
        const stillOnLogin = await findField(page, [PASSWORD_FIELD_SELECTOR]);
        status = stillOnLogin ? "fail" : "pass";
        actual = stillOnLogin
          ? "Login did not complete with this username variant — the password field is still present after submitting."
          : "Login completed successfully with this username variant, as expected.";
      }
    } else if (testCase.name.includes("visually masked")) {
      if (!passField) {
        status = "error";
        actual = "Could not reach the password step to check masking.";
      } else {
        const inputType = await passField.evaluate((el) => (el as HTMLInputElement).type).catch(() => "");
        const textSecurity = await passField
          .evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-text-security"))
          .catch(() => "");
        const masked = inputType === "password" || (!!textSecurity && textSecurity !== "none");
        status = masked ? "pass" : "fail";
        actual = masked
          ? "Password field is visually masked."
          : "Password field does not appear to be masked (not type=password, no text-security style detected).";
      }
    } else if (testCase.name.includes("empty password") || testCase.name.includes("whitespace-only password")) {
      if (!passField) {
        status = "error";
        actual = "Could not reach the password step to run this check.";
      } else {
        await passField.fill(password ?? "");
        const loginBtn = page.locator(SUBMIT_SELECTOR).first();
        const loginDisabled = (await loginBtn.count()) > 0 && (await loginBtn.isDisabled().catch(() => false));
        if (!loginDisabled) {
          await clickSubmit(page);
          await page.waitForTimeout(500);
        }
        const stillOnLogin = await findField(page, [PASSWORD_FIELD_SELECTOR]);
        status = loginDisabled || stillOnLogin ? "pass" : "fail";
        actual = loginDisabled
          ? "Login is disabled/blocked for empty/whitespace-only password input, as expected."
          : stillOnLogin
            ? "Login submission with empty/whitespace-only password was rejected — still on the login form."
            : "Login appears to have succeeded with empty/whitespace-only password input — verify manually.";
      }
    } else if (testCase.name.includes("padded password is rejected")) {
      if (!passField || !password) {
        status = "error";
        actual = "Could not reach the password step, or no password was available, to run this check.";
      } else {
        await passField.fill(password);
        await clickSubmit(page);
        await page.waitForTimeout(1000);
        const stillOnLogin = await findField(page, [PASSWORD_FIELD_SELECTOR]);
        status = stillOnLogin ? "pass" : "fail";
        actual = stillOnLogin
          ? "Padded password was correctly rejected (not trimmed) — still on the login form."
          : "Login succeeded with a padded password — the server may be trimming password input, which is a weaker posture than comparing it literally.";

        // This necessarily consumed one real failed login attempt against
        // the target account. Restore a known-good state immediately so a
        // scheduled/repeated run of this same check doesn't accumulate
        // failed attempts toward a real lockout over time.
        const restored = username && password.trim() ? await reattemptRealLogin(page, module.url, username, password.trim()) : true;
        if (!restored) {
          actual += " Warning: could not confirm the account was restored to a logged-in state with the correct password afterward — check manually.";
        }
      }
    } else {
      status = "error";
      actual = "No specific assertion is implemented for this login boundary case.";
    }
  } catch (err) {
    status = "error";
    actual = `Execution error: ${(err as Error).message}`;
  }

  const screenshotPath = await captureScreenshot(page, screenshotDir);
  return { status, actual, screenshotPath, durationMs: Date.now() - start };
}
