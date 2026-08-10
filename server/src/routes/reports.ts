import { FastifyInstance } from "fastify";
import { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../db.js";
import { buildFilteredHtmlReport } from "../report/filteredReportBuilder.js";

const testCaseReportInclude = {
  result: true,
  module: true,
  testRun: { include: { account: true, project: true } },
} satisfies Prisma.TestCaseInclude;

export type TestCaseReportRow = Prisma.TestCaseGetPayload<{ include: typeof testCaseReportInclude }>;

export interface TestCaseReportFilters {
  dateFrom?: Date;
  dateTo?: Date;
  moduleNames: string[];
}

function parseFilters(query: Record<string, unknown>): TestCaseReportFilters {
  const dateFromRaw = query.dateFrom as string | undefined;
  const dateToRaw = query.dateTo as string | undefined;
  const moduleRaw = query.module;
  const moduleNames = Array.isArray(moduleRaw) ? moduleRaw.map(String) : moduleRaw ? [String(moduleRaw)] : [];

  return {
    dateFrom: dateFromRaw ? new Date(`${dateFromRaw}T00:00:00.000Z`) : undefined,
    dateTo: dateToRaw ? new Date(`${dateToRaw}T23:59:59.999Z`) : undefined,
    moduleNames,
  };
}

function buildWhere(filters: TestCaseReportFilters) {
  const resultFilter: Record<string, unknown> = {};
  if (filters.dateFrom || filters.dateTo) {
    resultFilter.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  const where: Record<string, unknown> = { result: { is: resultFilter } };
  if (filters.moduleNames.length) {
    where.module = { name: { in: filters.moduleNames } };
  }
  return where;
}

export async function reportRoutes(app: FastifyInstance) {
  // Distinct module names available to filter by, for populating the report's module picker.
  app.get("/api/reports/modules", async () => {
    const modules = await prisma.module.findMany({
      distinct: ["name"],
      select: { name: true },
      orderBy: { name: "asc" },
    });
    return modules.map((m) => m.name);
  });

  app.get("/api/reports/test-cases", async (req) => {
    const filters = parseFilters(req.query as Record<string, unknown>);
    const where = buildWhere(filters);

    const testCases = await prisma.testCase.findMany({
      where,
      include: testCaseReportInclude,
      orderBy: { result: { createdAt: "desc" } },
    });

    const passed = testCases.filter((c) => c.result?.status === "pass").length;
    const failed = testCases.filter((c) => c.result?.status === "fail").length;
    const errored = testCases.filter((c) => c.result?.status === "error").length;

    return {
      filters: {
        dateFrom: filters.dateFrom?.toISOString().slice(0, 10) ?? null,
        dateTo: filters.dateTo?.toISOString().slice(0, 10) ?? null,
        moduleNames: filters.moduleNames,
      },
      totalCases: testCases.length,
      passedCases: passed,
      failedCases: failed,
      errorCases: errored,
      testCases,
    };
  });

  app.get("/api/reports/test-cases/export", async (req, reply) => {
    const filters = parseFilters(req.query as Record<string, unknown>);
    const where = buildWhere(filters);

    const testCases = await prisma.testCase.findMany({
      where,
      include: testCaseReportInclude,
      orderBy: { result: { createdAt: "desc" } },
    });

    const html = buildFilteredHtmlReport(testCases, filters);
    reply
      .header("Content-Disposition", `attachment; filename="test-case-report-${Date.now()}.html"`)
      .type("text/html")
      .send(html);
  });
}
