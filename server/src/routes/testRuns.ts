import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { runTestRun } from "../agent/runner.js";

export async function testRunRoutes(app: FastifyInstance) {
  app.get("/api/test-runs", async () => {
    return prisma.testRun.findMany({
      include: { account: true },
      orderBy: { startedAt: "desc" },
    });
  });

  app.get("/api/test-runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await prisma.testRun.findUnique({
      where: { id },
      include: {
        account: true,
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
      ...run,
      regressions: run.regressionsJson ? JSON.parse(run.regressionsJson) : null,
    };
  });

  app.post("/api/test-runs", async (req, reply) => {
    const body = req.body as { targetUrl: string; accountId?: string; mode?: "full" | "quick" };
    if (!body.targetUrl) return reply.code(400).send({ error: "targetUrl is required" });

    const run = await prisma.testRun.create({
      data: { targetUrl: body.targetUrl, accountId: body.accountId || null, mode: body.mode === "quick" ? "quick" : "full" },
    });

    // fire-and-forget; the run progresses asynchronously and the UI polls status
    runTestRun(run.id).catch((err) => {
      app.log.error(err, `test run ${run.id} failed`);
    });

    return reply.code(202).send(run);
  });
}
