import { Page } from "playwright";
import { DetectedModule, ExecutedResult } from "../types.js";
import { captureScreenshot } from "./executor.js";

export interface PerformanceMetrics {
  domContentLoadedMs: number;
  loadEventMs: number;
  resourceCount: number;
  transferSizeKb: number;
}

export interface PerformanceExecutionResult {
  result: ExecutedResult;
  metrics: PerformanceMetrics;
}

export async function executePerformanceCase(
  page: Page,
  module: DetectedModule,
  screenshotDir: string,
): Promise<PerformanceExecutionResult> {
  const start = Date.now();
  let metrics: PerformanceMetrics = { domContentLoadedMs: 0, loadEventMs: 0, resourceCount: 0, transferSizeKb: 0 };
  let status: ExecutedResult["status"] = "pass";
  let severity: ExecutedResult["severity"] = "info";
  let actual = "";

  try {
    await page.goto(module.url, { waitUntil: "load", timeout: 20000 });
    metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const transferSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
      return {
        domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
        loadEventMs: nav ? Math.round(nav.loadEventEnd) : 0,
        resourceCount: resources.length,
        transferSizeKb: Math.round(transferSize / 1024),
      };
    });

    const issues: string[] = [];
    if (metrics.domContentLoadedMs > 3000) {
      issues.push(`DOMContentLoaded took ${metrics.domContentLoadedMs}ms (>3000ms threshold)`);
      severity = "medium";
    }
    if (metrics.loadEventMs > 5000) {
      issues.push(`Load event took ${metrics.loadEventMs}ms (>5000ms threshold)`);
      severity = "medium";
    }
    if (metrics.transferSizeKb > 5000) {
      issues.push(`Page transferred ~${metrics.transferSizeKb}KB across ${metrics.resourceCount} resources (>5000KB threshold)`);
      if (severity === "info") severity = "low";
    }

    status = issues.length ? "fail" : "pass";
    actual = issues.length
      ? issues.join("; ")
      : `DOMContentLoaded ${metrics.domContentLoadedMs}ms, load ${metrics.loadEventMs}ms, ${metrics.resourceCount} resources (~${metrics.transferSizeKb}KB).`;
  } catch (err) {
    status = "error";
    actual = `Execution error: ${(err as Error).message}`;
  }

  const screenshotPath = await captureScreenshot(page, screenshotDir);
  return { result: { status, severity, actual, screenshotPath, durationMs: Date.now() - start }, metrics };
}
