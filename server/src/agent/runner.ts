import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../db.js";
import { crawlAndIdentifyModules } from "./crawler.js";
import { generateSmokeTests } from "./testGenerators/smoke.js";
import { generateBoundaryTests } from "./testGenerators/boundary.js";
import { generateVulnerabilityTests } from "./testGenerators/vulnerability.js";
import { executeBoundaryCase, executeSmokeCase, executeVulnerabilityCase } from "./executor.js";
import { buildHtmlReport } from "../report/reportBuilder.js";
import { DetectedModule, GeneratedTestCase } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCREENSHOT_DIR = path.join(__dirname, "..", "..", "storage", "screenshots");
export const REPORT_DIR = path.join(__dirname, "..", "..", "storage", "reports");

export async function runTestRun(testRunId: string): Promise<void> {
  const run = await prisma.testRun.findUniqueOrThrow({ where: { id: testRunId }, include: { account: true } });

  try {
    await prisma.testRun.update({ where: { id: testRunId }, data: { status: "crawling" } });

    const { modules, context, browser } = await crawlAndIdentifyModules({
      targetUrl: run.targetUrl,
      username: run.account?.username,
      password: run.account?.password,
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
      modules.map((m) =>
        prisma.module.create({
          data: {
            testRunId,
            name: m.name,
            url: m.url,
            type: m.type,
            fieldsJson: JSON.stringify(m.fields),
          },
        }),
      ),
    );
    const moduleByName = new Map<string, DetectedModule>(modules.map((m) => [m.name, m]));
    const moduleRecordByName = new Map(moduleRecords.map((m) => [m.name, m]));

    await prisma.testRun.update({ where: { id: testRunId }, data: { status: "generating" } });

    const generated: GeneratedTestCase[] = [
      ...generateSmokeTests(modules),
      ...generateBoundaryTests(modules),
      ...generateVulnerabilityTests(modules),
    ];

    await prisma.testRun.update({
      where: { id: testRunId },
      data: { status: "executing", totalCases: generated.length },
    });

    const page = await context.newPage();
    let passed = 0;
    let failed = 0;
    let errored = 0;

    for (const tc of generated) {
      const module = moduleByName.get(tc.moduleName);
      const moduleRecord = moduleRecordByName.get(tc.moduleName);
      if (!module) continue;

      const caseRecord = await prisma.testCase.create({
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
      try {
        if (tc.category === "smoke") {
          result = await executeSmokeCase(page, tc, module, SCREENSHOT_DIR);
        } else if (tc.category === "boundary") {
          result = await executeBoundaryCase(page, tc, module, SCREENSHOT_DIR);
        } else {
          result = await executeVulnerabilityCase(page, tc, module, SCREENSHOT_DIR);
        }
      } catch (err) {
        result = { status: "error" as const, actual: `Unhandled error: ${(err as Error).message}`, durationMs: 0 };
      }

      if (result.status === "pass") passed++;
      else if (result.status === "fail") failed++;
      else errored++;

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

      await prisma.testRun.update({
        where: { id: testRunId },
        data: { passedCases: passed, failedCases: failed, errorCases: errored },
      });
    }

    await context.close();
    await browser.close();

    const finished = await prisma.testRun.update({
      where: { id: testRunId },
      data: { status: "completed", completedAt: new Date() },
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
