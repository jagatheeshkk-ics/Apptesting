import path from "node:path";
import { fileURLToPath } from "node:url";
import { Page } from "playwright";
import { prisma } from "../db.js";
import { crawlAndIdentifyModules } from "./crawler.js";
import { generateSmokeTests } from "./testGenerators/smoke.js";
import { generateBoundaryTests } from "./testGenerators/boundary.js";
import { generateVulnerabilityTests } from "./testGenerators/vulnerability.js";
import { generateStressTests } from "./testGenerators/stress.js";
import { generatePerformanceTests } from "./testGenerators/performance.js";
import { generateCompatibilityTests } from "./testGenerators/compatibility.js";
import { generateAccessibilityTests } from "./testGenerators/accessibility.js";
import { executeBoundaryCase, executeSmokeCase, executeVulnerabilityCase } from "./executor.js";
import { executeStressCase } from "./stressExecutor.js";
import { executePerformanceCase } from "./performanceExecutor.js";
import { executeCompatibilityCase } from "./compatibilityExecutor.js";
import { executeAccessibilityCase } from "./accessibilityExecutor.js";
import { executeFlow } from "./flowExecutor.js";
import { generateUserStories } from "./userStoryGenerator.js";
import { computeRegressions } from "../analysis/regression.js";
import { buildHtmlReport } from "../report/reportBuilder.js";
import { DetectedModule, GeneratedTestCase, TestCategory } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCREENSHOT_DIR = path.join(__dirname, "..", "..", "storage", "screenshots");
export const REPORT_DIR = path.join(__dirname, "..", "..", "storage", "reports");

// How many test cases (or flows) run at once, each in its own browser tab
// sharing the crawl's logged-in session. Higher = faster runs, at the cost
// of more memory/CPU and more concurrent load against the target app.
// Override with TEST_EXECUTION_CONCURRENCY if the host is memory-constrained
// or the target app doesn't tolerate concurrent requests well.
const EXECUTION_CONCURRENCY = Math.max(1, Number(process.env.TEST_EXECUTION_CONCURRENCY) || 4);

// Runs `worker` over every item in `items`, at most `concurrency` at a time,
// using `pages[i]` for whichever items land on lane i.
async function runPooled<T>(items: T[], pages: Page[], worker: (item: T, page: Page) => Promise<void>): Promise<void> {
  let cursor = 0;
  const lane = async (page: Page) => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await worker(items[idx], page);
    }
  };
  await Promise.all(pages.map(lane));
}

async function buildGeneratedCases(
  modules: DetectedModule[],
  mode: string,
  enabledCategories: TestCategory[] | null,
  run: { targetUrl: string; accountId: string | null; id: string },
): Promise<GeneratedTestCase[]> {
  const allGenerated: GeneratedTestCase[] = [
    ...generateSmokeTests(modules),
    ...generateBoundaryTests(modules),
    ...generateVulnerabilityTests(modules),
    ...generateStressTests(modules),
    ...generatePerformanceTests(modules),
    ...generateCompatibilityTests(modules),
    ...generateAccessibilityTests(modules),
  ];

  const full = enabledCategories ? allGenerated.filter((tc) => enabledCategories.includes(tc.category)) : allGenerated;

  if (mode !== "quick") return full;

  // Sanity mode: smoke everywhere, plus only the specific cases that failed
  // in the most recent prior completed run for this same target/account.
  const previousRun = await prisma.testRun.findFirst({
    where: {
      targetUrl: run.targetUrl,
      accountId: run.accountId,
      status: "completed",
      id: { not: run.id },
    },
    orderBy: { startedAt: "desc" },
    include: { testCases: { include: { result: true } } },
  });

  if (!previousRun) {
    return full.filter((tc) => tc.category === "smoke");
  }

  const failedNames = new Set(
    previousRun.testCases.filter((c) => c.result && c.result.status !== "pass").map((c) => c.name),
  );

  return full.filter((tc) => tc.category === "smoke" || failedNames.has(tc.name));
}

export async function runTestRun(
  testRunId: string,
  opts?: { moduleStories?: Record<string, string[]>; username?: string; password?: string },
): Promise<void> {
  const run = await prisma.testRun.findUniqueOrThrow({ where: { id: testRunId }, include: { account: true } });

  try {
    await prisma.testRun.update({ where: { id: testRunId }, data: { status: "crawling" } });

    const { modules, context, browser } = await crawlAndIdentifyModules({
      targetUrl: run.targetUrl,
      // Prefer a linked Account's credentials; fall back to ad-hoc
      // credentials the user typed in for a login-gated URL that wasn't
      // saved as a reusable Account.
      username: run.account?.username ?? opts?.username,
      password: run.account?.password ?? opts?.password,
      onUsageEvent: (evt) => {
        prisma.usageEvent
          .create({
            data: {
              testRunId,
              url: evt.url,
              method: evt.method,
              statusCode: evt.statusCode,
              responseMs: evt.responseMs,
              consoleError: evt.consoleError,
            },
          })
          .catch(() => {});
      },
    });

    const moduleRecords = await Promise.all(
      modules.map(async (m) => {
        // Prefer stories the user reviewed/edited on the New Test Run page
        // (matched by module name); fall back to freshly generated ones for
        // any module that wasn't part of that preview (e.g. the preview
        // used a shallower crawl, or the user skipped it).
        const stories = opts?.moduleStories?.[m.name] ?? (await generateUserStories(m));
        return prisma.module.create({
          data: {
            testRunId,
            name: m.name,
            url: m.url,
            type: m.type,
            fieldsJson: JSON.stringify(m.fields),
            userStoriesJson: JSON.stringify(stories),
          },
        });
      }),
    );
    const moduleByName = new Map<string, DetectedModule>(modules.map((m) => [m.name, m]));
    const moduleRecordByName = new Map(moduleRecords.map((m) => [m.name, m]));

    await prisma.testRun.update({ where: { id: testRunId }, data: { status: "generating" } });

    const enabledCategories = run.enabledCategoriesJson ? (JSON.parse(run.enabledCategoriesJson) as TestCategory[]) : null;

    const generated = await buildGeneratedCases(modules, run.mode, enabledCategories, {
      targetUrl: run.targetUrl,
      accountId: run.accountId,
      id: run.id,
    });

    const matchingFlows =
      enabledCategories && !enabledCategories.includes("flow")
        ? []
        : await prisma.testFlow.findMany({
            where: {
              targetUrl: run.targetUrl,
              OR: [{ accountId: null }, { accountId: run.accountId }],
            },
            include: { steps: true },
          });

    await prisma.testRun.update({
      where: { id: testRunId },
      data: { status: "executing", totalCases: generated.length + matchingFlows.length },
    });

    let passed = 0;
    let failed = 0;
    let errored = 0;

    const tally = (status: string) => {
      if (status === "pass") passed++;
      else if (status === "fail") failed++;
      else errored++;
    };

    // Fire-and-forget: keeps the progress counters live without making every
    // case/flow wait on a DB round-trip before the next one can start.
    const flushProgress = () => {
      prisma.testRun
        .update({ where: { id: testRunId }, data: { passedCases: passed, failedCases: failed, errorCases: errored } })
        .catch(() => {});
    };

    const casesConcurrency = Math.min(EXECUTION_CONCURRENCY, Math.max(generated.length, 1));
    const casePages = await Promise.all(Array.from({ length: casesConcurrency }, () => context.newPage()));

    await runPooled(generated, casePages, async (tc, page) => {
      const module = moduleByName.get(tc.moduleName);
      const moduleRecord = moduleRecordByName.get(tc.moduleName);
      if (!module) return;

      // Overlap the DB insert with test execution — nothing about running
      // the case depends on the row existing yet, only the result write does.
      const caseRecordPromise = prisma.testCase.create({
        data: {
          testRunId,
          moduleId: moduleRecord?.id,
          category: tc.category,
          name: tc.name,
          description: tc.description,
          inputJson: tc.input ? JSON.stringify(tc.input) : null,
        },
      });

      let result;
      let stressMetrics: Awaited<ReturnType<typeof executeStressCase>>["metrics"] | undefined;
      let perfMetrics: Awaited<ReturnType<typeof executePerformanceCase>>["metrics"] | undefined;
      try {
        if (tc.category === "smoke") {
          result = await executeSmokeCase(page, tc, module, SCREENSHOT_DIR);
        } else if (tc.category === "boundary") {
          result = await executeBoundaryCase(page, tc, module, SCREENSHOT_DIR);
        } else if (tc.category === "vulnerability") {
          result = await executeVulnerabilityCase(page, tc, module, SCREENSHOT_DIR);
        } else if (tc.category === "performance") {
          const perf = await executePerformanceCase(page, module, SCREENSHOT_DIR);
          result = perf.result;
          perfMetrics = perf.metrics;
        } else if (tc.category === "compatibility") {
          result = await executeCompatibilityCase(page, tc, module, SCREENSHOT_DIR);
        } else if (tc.category === "accessibility") {
          result = await executeAccessibilityCase(page, module, SCREENSHOT_DIR);
        } else {
          const stress = await executeStressCase(tc.name, module, (o) => {
            prisma.usageEvent
              .create({
                data: {
                  testRunId,
                  url: module.url,
                  method: "STRESS",
                  statusCode: o.status || undefined,
                  responseMs: o.ms,
                  consoleError: o.error,
                },
              })
              .catch(() => {});
          });
          result = stress.result;
          stressMetrics = stress.metrics;
        }
      } catch (err) {
        result = { status: "error" as const, actual: `Unhandled error: ${(err as Error).message}`, durationMs: 0 };
      }

      tally(result.status);
      flushProgress();

      const caseRecord = await caseRecordPromise;

      await prisma.testResult.create({
        data: {
          testCaseId: caseRecord.id,
          status: result.status,
          severity: "severity" in result ? result.severity : undefined,
          actual: result.actual,
          screenshotPath: result.screenshotPath,
          durationMs: result.durationMs,
        },
      });

      if (stressMetrics) {
        await prisma.stressMetric.create({
          data: {
            testCaseId: caseRecord.id,
            concurrency: stressMetrics.concurrency,
            totalRequests: stressMetrics.totalRequests,
            errorCount: stressMetrics.errorCount,
            errorRatePct: stressMetrics.errorRatePct,
            avgLatencyMs: stressMetrics.avgLatencyMs,
            p95LatencyMs: stressMetrics.p95LatencyMs,
          },
        });
      }

      if (perfMetrics) {
        await prisma.performanceMetric.create({
          data: {
            testCaseId: caseRecord.id,
            domContentLoadedMs: perfMetrics.domContentLoadedMs,
            loadEventMs: perfMetrics.loadEventMs,
            resourceCount: perfMetrics.resourceCount,
            transferSizeKb: perfMetrics.transferSizeKb,
          },
        });
      }
    });

    const flowConcurrency = Math.min(EXECUTION_CONCURRENCY, Math.max(matchingFlows.length, 1));
    const flowPages =
      flowConcurrency <= casePages.length
        ? casePages.slice(0, flowConcurrency)
        : [
            ...casePages,
            ...(await Promise.all(Array.from({ length: flowConcurrency - casePages.length }, () => context.newPage()))),
          ];

    await runPooled(matchingFlows, flowPages, async (flow, page) => {
      const caseRecord = await prisma.testCase.create({
        data: {
          testRunId,
          testFlowId: flow.id,
          category: "flow",
          name: `Flow: ${flow.label}`,
          description: `Multi-step flow with ${flow.steps.length} step(s), covering integration/system/functional/UAT-style checks.`,
        },
      });

      let overallStatus: "pass" | "fail" | "error" = "error";
      let summary = "";
      try {
        const flowResult = await executeFlow(page, flow.steps, SCREENSHOT_DIR);
        overallStatus = flowResult.overallStatus;
        summary = flowResult.summary;

        await Promise.all(
          flowResult.stepOutcomes.map((s) =>
            prisma.flowStepResult.create({
              data: {
                testCaseId: caseRecord.id,
                order: s.order,
                action: s.action,
                status: s.status,
                detail: s.detail,
                screenshotPath: s.screenshotPath,
                durationMs: s.durationMs,
              },
            }),
          ),
        );
      } catch (err) {
        summary = `Unhandled error: ${(err as Error).message}`;
      }

      tally(overallStatus);
      flushProgress();

      await prisma.testResult.create({
        data: {
          testCaseId: caseRecord.id,
          status: overallStatus,
          actual: summary,
          durationMs: 0,
        },
      });
    });

    flushProgress();
    await prisma.testRun.update({
      where: { id: testRunId },
      data: { passedCases: passed, failedCases: failed, errorCases: errored },
    });

    await context.close();
    await browser.close();

    const finished = await prisma.testRun.update({
      where: { id: testRunId },
      data: { status: "completed", completedAt: new Date() },
    });

    const regressions = await computeRegressions(testRunId);
    await prisma.testRun.update({
      where: { id: testRunId },
      data: { regressionsJson: JSON.stringify(regressions) },
    });

    const reportPath = await buildHtmlReport(finished.id, REPORT_DIR, SCREENSHOT_DIR);
    await prisma.testRun.update({ where: { id: testRunId }, data: { reportPath } });
  } catch (err) {
    await prisma.testRun.update({
      where: { id: testRunId },
      data: { status: "failed", error: (err as Error).message, completedAt: new Date() },
    });
  }
}
