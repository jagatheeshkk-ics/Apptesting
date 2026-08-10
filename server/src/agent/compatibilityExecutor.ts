import { Page } from "playwright";
import { DetectedModule, ExecutedResult, GeneratedTestCase } from "../types.js";
import { captureScreenshot } from "./executor.js";

export async function executeCompatibilityCase(
  page: Page,
  testCase: GeneratedTestCase,
  module: DetectedModule,
  screenshotDir: string,
): Promise<ExecutedResult> {
  const start = Date.now();
  const width = Number(testCase.input?.width ?? 1280);
  const height = Number(testCase.input?.height ?? 720);

  let status: ExecutedResult["status"] = "pass";
  let actual = "";
  const consoleErrors: string[] = [];
  const listener = (msg: any) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  };
  page.on("console", listener);

  try {
    await page.setViewportSize({ width, height });
    await page.goto(module.url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(300);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const overflow = scrollWidth > width + 5;

    const issues: string[] = [];
    if (overflow) issues.push(`Horizontal overflow: content is ${scrollWidth}px wide at a ${width}px viewport.`);
    if (consoleErrors.length) issues.push(`${consoleErrors.length} console error(s).`);

    status = issues.length ? "fail" : "pass";
    actual = issues.length ? issues.join(" ") : `Renders cleanly at ${width}x${height}, no overflow or console errors.`;
  } catch (err) {
    status = "error";
    actual = `Execution error: ${(err as Error).message}`;
  } finally {
    page.off("console", listener);
  }

  const screenshotPath = await captureScreenshot(page, screenshotDir);
  return { status, actual, screenshotPath, durationMs: Date.now() - start };
}
