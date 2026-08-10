import { FastifyInstance } from "fastify";
import { computeAccountKpis, computeAgentPerformanceKpi } from "../kpi/aggregator.js";

export async function kpiRoutes(app: FastifyInstance) {
  app.get("/api/kpi/accounts", async () => computeAccountKpis());
  app.get("/api/kpi/agent", async () => computeAgentPerformanceKpi());
}
