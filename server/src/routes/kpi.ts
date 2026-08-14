import { FastifyInstance } from "fastify";
import { computeAccountKpis, computeAgentPerformanceKpi, computeDashboardSummary, computeProjectKpis } from "../kpi/aggregator.js";

export async function kpiRoutes(app: FastifyInstance) {
  app.get("/api/kpi/accounts", async () => computeAccountKpis());
  app.get("/api/kpi/agent", async () => computeAgentPerformanceKpi());
  app.get("/api/kpi/projects", async () => computeProjectKpis());

  app.get("/api/kpi/dashboard", async (req, reply) => {
    const q = req.query as { projectId?: string; accountId?: string; from?: string; to?: string; groupBy?: string };

    let projectId: string | null | undefined;
    if (q.projectId === "unassigned") projectId = null;
    else if (q.projectId) projectId = q.projectId;

    let from: Date | undefined;
    let to: Date | undefined;
    if (q.from) {
      from = new Date(q.from);
      if (Number.isNaN(from.getTime())) return reply.code(400).send({ error: "invalid from date" });
    }
    if (q.to) {
      to = new Date(q.to);
      if (Number.isNaN(to.getTime())) return reply.code(400).send({ error: "invalid to date" });
      to.setHours(23, 59, 59, 999); // inclusive of the whole "to" day
    }

    const groupBy = q.groupBy === "week" ? "week" : "day";

    return computeDashboardSummary({ projectId, accountId: q.accountId, from, to, groupBy });
  });
}
