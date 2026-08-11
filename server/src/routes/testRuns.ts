import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { runTestRun } from "../agent/runner.js";
import { TestCategory } from "../types.js";

const TEST_CATEGORIES: TestCategory[] = [
  "smoke",
  "boundary",
  "vulnerability",
  "stress",
  "performance",
  "compatibility",
  "accessibility",
  "flow",
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

  app.post("/api/test-runs", async (req, reply) => {
    const body = req.body as {
      targetUrl: string;
      accountId?: string;
      projectId?: string;
      mode?: "full" | "quick";
      enabledCategories?: unknown;
      moduleStories?: Record<string, string[]>;
    };
    if (!body.targetUrl) return reply.code(400).send({ error: "targetUrl is required" });

    let enabledCategories: TestCategory[] | null = null;
    if (body.enabledCategories !== undefined) {
      if (!Array.isArray(body.enabledCategories) || !body.enabledCategories.every(isTestCategory)) {
        return reply.code(400).send({ error: "enabledCategories must be an array of valid test category keys" });
      }
      if (body.enabledCategories.length) enabledCategories = body.enabledCategories as TestCategory[];
    }

    let projectId = body.projectId || null;
    if (!projectId && body.accountId) {
      const account = await prisma.account.findUnique({ where: { id: body.accountId } });
      projectId = account?.projectId ?? null;
    }

    const run = await prisma.testRun.create({
      data: {
        targetUrl: body.targetUrl,
        accountId: body.accountId || null,
        projectId,
        mode: body.mode === "quick" ? "quick" : "full",
        enabledCategoriesJson: enabledCategories ? JSON.stringify(enabledCategories) : null,
      },
    });

    // fire-and-forget; the run progresses asynchronously and the UI polls status
    runTestRun(run.id, { moduleStories: body.moduleStories }).catch((err) => {
      app.log.error(err, `test run ${run.id} failed`);
    });

    return reply.code(202).send(run);
  });
}
