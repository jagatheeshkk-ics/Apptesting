import { Page } from "playwright";
import { captureScreenshot } from "./executor.js";

export interface FlowStepDef {
  order: number;
  action: string;
  selector?: string | null;
  value?: string | null;
}

export interface FlowStepOutcome {
  order: number;
  action: string;
  status: "pass" | "fail" | "error";
  detail: string;
  screenshotPath?: string;
  durationMs: number;
}

export interface FlowExecutionResult {
  stepOutcomes: FlowStepOutcome[];
  overallStatus: "pass" | "fail" | "error";
  summary: string;
}

export async function executeFlow(
  page: Page,
  steps: FlowStepDef[],
  screenshotDir: string,
): Promise<FlowExecutionResult> {
  const orderedSteps = [...steps].sort((a, b) => a.order - b.order);
  const stepOutcomes: FlowStepOutcome[] = [];

  for (const step of orderedSteps) {
    const start = Date.now();
    let status: FlowStepOutcome["status"] = "pass";
    let detail = "";

    try {
      switch (step.action) {
        case "navigate":
          await page.goto(step.value ?? "", { waitUntil: "domcontentloaded", timeout: 15000 });
          detail = `Navigated to ${step.value}`;
          break;
        case "fill":
          await page.locator(step.selector ?? "").first().fill(step.value ?? "", { timeout: 5000 });
          detail = `Filled "${step.selector}" with "${step.value}"`;
          break;
        case "click":
          await Promise.allSettled([
            page.waitForNavigation({ timeout: 5000 }),
            page.locator(step.selector ?? "").first().click({ timeout: 5000 }),
          ]);
          detail = `Clicked "${step.selector}"`;
          break;
        case "expectUrlContains": {
          const ok = page.url().includes(step.value ?? "");
          status = ok ? "pass" : "fail";
          detail = ok ? `URL contains "${step.value}"` : `Expected URL to contain "${step.value}", got "${page.url()}"`;
          break;
        }
        case "expectTextContains": {
          const scope = step.selector ? page.locator(step.selector).first() : page.locator("body");
          const text = await scope.innerText().catch(() => "");
          const ok = text.includes(step.value ?? "");
          status = ok ? "pass" : "fail";
          detail = ok
            ? `Found expected text "${step.value}"`
            : `Expected text "${step.value}" not found${step.selector ? ` in "${step.selector}"` : ""}`;
          break;
        }
        case "expectElementVisible": {
          const visible = await page
            .locator(step.selector ?? "")
            .first()
            .isVisible()
            .catch(() => false);
          status = visible ? "pass" : "fail";
          detail = visible ? `"${step.selector}" is visible` : `"${step.selector}" is not visible`;
          break;
        }
        default:
          status = "error";
          detail = `Unknown step action "${step.action}"`;
      }
    } catch (err) {
      status = "error";
      detail = `Step failed: ${(err as Error).message}`;
    }

    const screenshotPath = await captureScreenshot(page, screenshotDir);
    stepOutcomes.push({ order: step.order, action: step.action, status, detail, screenshotPath, durationMs: Date.now() - start });

    if (status !== "pass") break;
  }

  const last = stepOutcomes[stepOutcomes.length - 1];
  const overallStatus = last?.status ?? "error";
  const summary =
    overallStatus === "pass"
      ? `All ${orderedSteps.length} step(s) passed.`
      : `Stopped at step ${stepOutcomes.length}/${orderedSteps.length} (${last?.action}): ${last?.detail}`;

  return { stepOutcomes, overallStatus, summary };
}
