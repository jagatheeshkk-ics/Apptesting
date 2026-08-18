import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { runTestRun } from "../agent/runner.js";
import { getCurrentUsername } from "../auth/currentUser.js";
import { buildTestRunXlsx } from "../report/xlsxReportBuilder.js";
import { TestCategory } from "../types.js";

const TEST_CATEGORIES: TestCategory[] = [
  "smoke",
  "boundary",
  "vulnerability",
  "loginBoundary",
  "stress",
  "performance",
  "compatibility",
  "accessibility",
  "flow",
  "story",
];

function isTestCategory(value: unknown): value is TestCategory {
  return typeof value === "string" && (TEST_CATEGORIES as string[]).includes(value);
}

function withParsedModules<T extends { modules?: { userStoriesJson: string | null }[] }>(run: T) {
  if (!run.modules) return run;
  return {
    ...run,
    modules: run.modules.map((m) => ({ ...m, userStories: m.userStoriesJson ? JSON.parse(m.userStoriesJson) : [] })),
  };
}

export async function testRunRoutes(app: FastifyInstance) {
  app.get("/api/test-runs", async () => {
    return prisma.testRun.findMany({
      include: { account: true, project: true },
      orderBy: { startedAt: "desc" },
    });
  });

  app.get("/api/test-runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await prisma.testRun.findUnique({
      where: { id },
      include: {
        account: true,
        project: true,
        testCases: {
          include: {
            result: true,
            module: true,
            stressMetric: true,
            performanceMetric: true,
            flowStepResults: { orderBy: { order: "asc" } },
            testFlow: true,
          },
        },
        modules: true,
      },
    });
    if (!run) return reply.code(404).send({ error: "not found" });
    return {
      ...withParsedModules(run),
      regressions: run.regressionsJson ? JSON.parse(run.regressionsJson) : null,
      enabledCategories: run.enabledCategoriesJson ? JSON.parse(run.enabledCategoriesJson) : null,
    };
  });

  app.get("/api/test-runs/:id/report.xlsx", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await prisma.testRun.findUnique({ where: { id }, select: { id: true } });
    if (!run) return reply.code(404).send({ error: "not found" });

    const buffer = await buildTestRunXlsx(id);
    reply
      .header("Content-Disposition", `attachment; filename="test-run-${id}.xlsx"`)
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(buffer);
  });

  app.post("/api/test-runs", async (req, reply) => {
    const body = req.body as {
      targetUrl: string;
      accountId?: string;
      projectId?: string;
      mode?: "full" | "quick";
      enabledCategories?: unknown;
      // Tester-entered business module name (e.g. "Payroll") this run is
      // testing — required, independent of whatever titles the crawler
      // finds on the page.
      moduleName?: string;
      // Freeform QA scenarios in plain English, typed on the New Test Run
      // page for that module — converted into executable test flows by the
      // AI generator.
      testStories?: string;
      // Ad-hoc login credentials for this target URL, used when the URL was
      // detected as login-gated (POST /api/analyze -> requiresLogin) and no
      // existing Account was picked. Not persisted on the TestRun itself —
      // either promoted to a real Account (if saveAsAccount) or passed
      // through to the crawl transiently.
      username?: string;
      password?: string;
      saveAsAccount?: boolean;
      accountLabel?: string;
    };
    if (!body.targetUrl) return reply.code(400).send({ error: "targetUrl is required" });
    if (!body.moduleName?.trim()) return reply.code(400).send({ error: "moduleName is required" });

    // Two runs against the same target executing concurrently double up on
    // Playwright/DB load (each run does several test cases in parallel
    // already) without any real benefit — that's saturated the pooled DB
    // connection limit and made unrelated requests crawl in practice. Block
    // starting a new one until the in-flight run for this target finishes.
    const activeRun = await prisma.testRun.findFirst({
      where: { targetUrl: body.targetUrl, status: { in: ["crawling", "generating", "executing"] } },
      select: { id: true, status: true },
    });
    if (activeRun) {
      return reply.code(409).send({
        error: `A test run (${activeRun.id}) is already ${activeRun.status} against this target URL. Wait for it to finish before starting another.`,
      });
    }

    let enabledCategories: TestCategory[] | null = null;
    if (body.enabledCategories !== undefined) {
      if (!Array.isArray(body.enabledCategories) || !body.enabledCategories.every(isTestCategory)) {
        return reply.code(400).send({ error: "enabledCategories must be an array of valid test category keys" });
      }
      if (body.enabledCategories.length) enabledCategories = body.enabledCategories as TestCategory[];
    }

    let accountId = body.accountId || null;
    let projectId = body.projectId || null;
    if (!projectId && accountId) {
      const account = await prisma.account.findUnique({ where: { id: accountId } });
      projectId = account?.projectId ?? null;
    }

    if (!accountId && body.saveAsAccount && body.username && body.password) {
      const saved = await prisma.account.create({
        data: {
          label: body.accountLabel?.trim() || `Login for ${new URL(body.targetUrl).hostname}`,
          targetUrl: body.targetUrl,
          username: body.username,
          password: body.password,
          projectId,
        },
      });
      accountId = saved.id;
    }

    const createdByUsername = await getCurrentUsername(req);

    const run = await prisma.testRun.create({
      data: {
        targetUrl: body.targetUrl,
        accountId,
        projectId,
        mode: body.mode === "quick" ? "quick" : "full",
        enabledCategoriesJson: enabledCategories ? JSON.stringify(enabledCategories) : null,
        createdByUsername,
        moduleName: body.moduleName.trim(),
        testStories: body.testStories?.trim() || null,
      },
    });

    // fire-and-forget; the run progresses asynchronously and the UI polls status
    const adHocCredentials = accountId ? undefined : { username: body.username, password: body.password };
    runTestRun(run.id, {
      testStories: body.testStories,
      ...adHocCredentials,
    }).catch((err) => {
      app.log.error(err, `test run ${run.id} failed`);
    });

    return reply.code(202).send(run);
  });
}
