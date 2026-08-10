import { FastifyInstance } from "fastify";
import { computeAccountKpis, computeAgentPerformanceKpi, computeProjectKpis } from "../kpi/aggregator.js";

export async function kpiRoutes(app: FastifyInstance) {
  app.get("/api/kpi/accounts", async () => computeAccountKpis());
  app.get("/api/kpi/agent", async () => computeAgentPerformanceKpi());
  app.get("/api/kpi/projects", async () => computeProjectKpis());
}
