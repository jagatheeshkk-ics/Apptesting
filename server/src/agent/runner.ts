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
import { executeFlow, FlowStepDef } from "./flowExecutor.js";
import { generateStoryFlows } from "./storyFlowGenerator.js";
import { computeRegressions } from "../analysis/regression.js";
import { buildHtmlReport } from "../report/reportBuilder.js";
import { DetectedModule, GeneratedTestCase, TestCategory, TestType } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCREENSHOT_DIR = path.join(__dirname, "..", "..", "storage", "screenshots");
export const REPORT_DIR = path.join(__dirname, "..", "..", "storage", "reports");

// How many test cases (or flows) run at once, each in its own browser tab
// sharing the crawl's logged-in session. Higher = faster runs, at the cost
// of more memory/CPU and more concurrent load against the target app.
// Override with TEST_EXECUTION_CONCURRENCY if the host is memory-constrained
// or the target app doesn't tolerate concurrent requests well.
const EXECUTION_CONCURRENCY = Math.max(1, Number(process.env.TEST_EXECUTION_CONCURRENCY) || 4);

// A saved TestFlow and an AI-generated custom test story both boil down to
// "run this ordered sequence of steps and record the outcome" — this shape
// lets both be executed through the same pooled loop.
interface StoryFlowLike {
  category: "flow" | "story";
  testFlowId?: string;
  name: string;
  description: string;
  expectation: string;
  testType: TestType;
  steps: FlowStepDef[];
}

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
  opts?: { username?: string; password?: string; testStories?: string },
): Promise<void> {
  const run = await prisma.testRun.findUniqueOrThrow({ where: { id: testRunId }, include: { account: true } });

  try {
    await prisma.testRun.update({ where: { id: testRunId }, data: { status: "crawling" } });

    const credentialUsername = run.account?.username ?? opts?.username;
    const credentialPassword = run.account?.password ?? opts?.password;
    const { modules, context, browser, loggedIn } = await crawlAndIdentifyModules({
      targetUrl: run.targetUrl,
      // Prefer a linked Account's credentials; fall back to ad-hoc
      // credentials the user typed in for a login-gated URL that wasn't
      // saved as a reusable Account.
      username: credentialUsername,
      password: credentialPassword,
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
    if (credentialUsername && credentialPassword && !loggedIn) {
      console.error(
        `runTestRun ${testRunId}: credentials were provided for ${run.targetUrl} but login could not be confirmed — the run continued and will likely only cover the anonymous/login-page content. Check crawlAndIdentifyModules logs above for why the login form wasn't recognized or was rejected.`,
      );
    }

    // Crawled purely to drive field-based test generation below — the
    // tester's own description of what to test lives on the run itself
    // (run.moduleName / opts.testStories), not per crawled page.
    const moduleRecords = [];
    for (const m of modules) {
      moduleRecords.push(
        await prisma.module.create({
          data: {
            testRunId,
            name: m.name,
            url: m.url,
            type: m.type,
            fieldsJson: JSON.stringify(m.fields),
          },
        }),
      );
    }
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

    // Freeform scenarios typed on the New Test Run page, converted into
    // executable flows by the AI generator. `null` means it couldn't be
    // done at all (no GEMINI_API_KEY, or the call/parse failed) — that's
    // surfaced as a single visible error case below rather than silently
    // dropping the tester's input.
    const storiesEnabled = !enabledCategories || enabledCategories.includes("story");
    let storyFlows: StoryFlowLike[] = [];
    let storyFlowsError: string | null = null;
    if (storiesEnabled && opts?.testStories?.trim()) {
      const generatedStories = await generateStoryFlows(opts.testStories, modules);
      if (generatedStories === "daily-quota-exhausted") {
        storyFlowsError =
          "Could not process the custom test stories — Gemini's free-tier daily request quota is exhausted for today. It resets after 24 hours, or you can enable billing on your Google AI Studio project to remove the daily cap.";
      } else if (generatedStories === "overloaded") {
        storyFlowsError =
          "Could not process the custom test stories — Google's AI service was briefly overloaded with demand, even after retrying. Try running again in a minute or two.";
      } else if (generatedStories === null) {
        storyFlowsError = process.env.GEMINI_API_KEY
          ? "Could not process the custom test stories — the AI call failed or returned an unexpected format. Try rephrasing the scenarios, or check the server logs."
          : "Could not process the custom test stories — GEMINI_API_KEY is not configured on the server, so natural-language scenarios can't be converted into test steps.";
      } else if (!generatedStories.flows.length && generatedStories.requiredDetails.length) {
        // The AI needs specific details it can't infer (a real record ID,
        // etc.) that weren't answered — normally the New Test Run page
        // collects these before the run starts; this is the fallback for a
        // run started without going through that step (e.g. via the API).
        storyFlowsError = `Could not run the custom test stories — some details are needed first: ${generatedStories.requiredDetails.map((d) => d.question).join(" ")}`;
      } else {
        storyFlows = generatedStories.flows.map((s) => ({
          category: "story" as const,
          testFlowId: undefined,
          name: s.title,
          description: `Custom test story: ${s.title}`,
          expectation: s.expectation,
          testType: s.testType,
          steps: s.steps,
        }));
      }
    }

    const flowItems: StoryFlowLike[] = [
      ...matchingFlows.map((flow) => ({
        category: "flow" as const,
        testFlowId: flow.id,
        name: `Flow: ${flow.label}`,
        description: `Multi-step flow with ${flow.steps.length} step(s), covering integration/system/functional/UAT-style checks.`,
        expectation: `All ${flow.steps.length} step(s) of the flow should complete successfully, in order.`,
        testType: "positive" as TestType,
        steps: flow.steps,
      })),
      ...storyFlows,
    ];

    await prisma.testRun.update({
      where: { id: testRunId },
      data: {
        status: "executing",
        totalCases: generated.length + flowItems.length + (storyFlowsError ? 1 : 0),
      },
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
          expectation: tc.expectation,
          testType: tc.testType,
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

    const flowConcurrency = Math.min(EXECUTION_CONCURRENCY, Math.max(flowItems.length, 1));
    const flowPages =
      flowConcurrency <= casePages.length
        ? casePages.slice(0, flowConcurrency)
        : [
            ...casePages,
            ...(await Promise.all(Array.from({ length: flowConcurrency - casePages.length }, () => context.newPage()))),
          ];

    await runPooled(flowItems, flowPages, async (item, page) => {
      const caseRecord = await prisma.testCase.create({
        data: {
          testRunId,
          testFlowId: item.testFlowId,
          category: item.category,
          name: item.name,
          description: item.description,
          expectation: item.expectation,
          testType: item.testType,
        },
      });

      let overallStatus: "pass" | "fail" | "error" = "error";
      let summary = "";
      try {
        const flowResult = await executeFlow(page, item.steps, SCREENSHOT_DIR);
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

    if (storyFlowsError) {
      const caseRecord = await prisma.testCase.create({
        data: {
          testRunId,
          category: "story",
          name: "Custom test stories",
          description: "Custom test story processing",
          expectation: opts?.testStories ?? "",
          testType: "positive",
        },
      });
      await prisma.testResult.create({
        data: { testCaseId: caseRecord.id, status: "error", actual: storyFlowsError, durationMs: 0 },
      });
      tally("error");
    }

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
