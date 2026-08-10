import { Page } from "playwright";
import { DetectedModule, ExecutedResult } from "../types.js";
import { captureScreenshot } from "./executor.js";

export async function executeAccessibilityCase(
  page: Page,
  module: DetectedModule,
  screenshotDir: string,
): Promise<ExecutedResult> {
  const start = Date.now();
  let status: ExecutedResult["status"] = "pass";
  let severity: ExecutedResult["severity"] = "info";
  let actual = "";

  try {
    await page.goto(module.url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(200);

    const issues = await page.evaluate(() => {
      const found: string[] = [];

      document.querySelectorAll("img").forEach((img) => {
        if (!img.hasAttribute("alt")) {
          found.push(`Image missing alt text: ${img.getAttribute("src")?.slice(0, 60) ?? "(no src)"}`);
        }
      });

      document.querySelectorAll("input, textarea, select").forEach((el) => {
        const type = (el as HTMLInputElement).type;
        if (["hidden", "submit", "button", "reset", "image"].includes(type)) return;
        const id = el.id;
        const hasLabel = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const hasAria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
        if (!hasLabel && !hasAria) {
          const name = el.getAttribute("name") || el.tagName.toLowerCase();
          found.push(`Form control missing an associated label: "${name}"`);
        }
      });

      document.querySelectorAll("button, a").forEach((el) => {
        const text = el.textContent?.trim();
        const hasAria = el.getAttribute("aria-label");
        if (!text && !hasAria) {
          found.push(`Interactive <${el.tagName.toLowerCase()}> element has no accessible text`);
        }
      });

      if (!document.documentElement.lang) found.push("Missing <html lang> attribute");
      if (!document.title?.trim()) found.push("Missing document <title>");

      return found;
    });

    status = issues.length ? "fail" : "pass";
    severity = issues.length > 5 ? "medium" : issues.length > 0 ? "low" : "info";
    actual = issues.length
      ? `${issues.length} issue(s): ${issues.slice(0, 10).join("; ")}${issues.length > 10 ? "; …" : ""}`
      : "No accessibility heuristics violated (alt text, labels, lang, title all present).";
  } catch (err) {
    status = "error";
    actual = `Execution error: ${(err as Error).message}`;
  }

  const screenshotPath = await captureScreenshot(page, screenshotDir);
  return { status, severity, actual, screenshotPath, durationMs: Date.now() - start };
}
