import ExcelJS from "exceljs";
import { prisma } from "../db.js";
import { testTypesLabel } from "./reportBuilder.js";
import { buildNarrativeSummary } from "./narrativeSummary.js";
import { RegressionSummary } from "../analysis/regression.js";

export async function buildTestRunXlsx(testRunId: string): Promise<Buffer> {
  const run = await prisma.testRun.findUniqueOrThrow({
    where: { id: testRunId },
    include: {
      modules: true,
      testCases: {
        include: {
          result: true,
          stressMetric: true,
          performanceMetric: true,
          flowStepResults: { orderBy: { order: "asc" } },
        },
      },
    },
  });

  const byCategory: Record<string, typeof run.testCases> = {
    smoke: [],
    boundary: [],
    vulnerability: [],
    loginBoundary: [],
    stress: [],
    performance: [],
    compatibility: [],
    accessibility: [],
    flow: [],
    story: [],
  };
  for (const tc of run.testCases) byCategory[tc.category]?.push(tc);

  const wb = new ExcelJS.Workbook();
  wb.creator = "AppTesting Agent";
  wb.created = new Date();

  const addFlowLikeSheet = (sheetName: string, cases: typeof run.testCases) => {
    if (!cases.length) return;
    const sheet = wb.addWorksheet(sheetName);
    sheet.columns = [
      { header: "Name", key: "flow", width: 34 },
      { header: "Status", key: "status", width: 10 },
      { header: "Expected", key: "expected", width: 50 },
      { header: "Actual", key: "actual", width: 50 },
      { header: "Step #", key: "step", width: 8 },
      { header: "Action", key: "action", width: 30 },
      { header: "Step status", key: "stepStatus", width: 10 },
      { header: "Detail", key: "detail", width: 50 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const tc of cases) {
      if (!tc.flowStepResults.length) {
        sheet.addRow({
          flow: tc.name,
          status: tc.result?.status ?? "—",
          expected: tc.expectation ?? "—",
          actual: tc.result?.actual ?? "—",
        });
        continue;
      }
      for (const s of tc.flowStepResults) {
        sheet.addRow({
          flow: tc.name,
          status: tc.result?.status ?? "—",
          expected: tc.expectation ?? "—",
          actual: tc.result?.actual ?? "—",
          step: s.order + 1,
          action: s.action,
          stepStatus: s.status,
          detail: s.detail,
        });
      }
    }
  };

  const regressions: RegressionSummary | null = run.regressionsJson ? JSON.parse(run.regressionsJson) : null;
  const narrativeSummary = buildNarrativeSummary(
    {
      targetUrl: run.targetUrl,
      moduleName: run.moduleName,
      mode: run.mode,
      totalCases: run.totalCases,
      passedCases: run.passedCases,
      failedCases: run.failedCases,
      errorCases: run.errorCases,
    },
    run.testCases.map((tc) => ({ category: tc.category, name: tc.name, result: tc.result ? { status: tc.result.status, severity: tc.result.severity } : null })),
    regressions,
  );

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Field", key: "field", width: 22 },
    { header: "Value", key: "value", width: 70 },
  ];
  summary.getRow(1).font = { bold: true };
  const summaryRow = summary.addRow({ field: "Summary", value: narrativeSummary });
  summaryRow.alignment = { wrapText: true, vertical: "top" };
  summaryRow.height = 60;
  summary.addRows([
    { field: "Module", value: run.moduleName ?? "—" },
    { field: "Target", value: run.targetUrl },
    { field: "Page(s)/form(s) discovered", value: run.modules.map((m) => m.name).join(", ") || "—" },
    { field: "Run by", value: run.createdByUsername ?? "Unknown" },
    { field: "Mode", value: `${run.mode === "quick" ? "Quick/sanity — " : ""}${testTypesLabel(run.enabledCategoriesJson)}` },
    { field: "Run started", value: run.startedAt.toISOString() },
    { field: "Run completed", value: run.completedAt?.toISOString() ?? "—" },
    { field: "Total cases", value: run.totalCases },
    { field: "Passed", value: run.passedCases },
    { field: "Failed", value: run.failedCases },
    { field: "Errors", value: run.errorCases },
  ]);

  const genericRows = [
    ...byCategory.smoke,
    ...byCategory.boundary,
    ...byCategory.vulnerability,
    ...byCategory.loginBoundary,
    ...byCategory.compatibility,
    ...byCategory.accessibility,
  ];
  if (genericRows.length) {
    const sheet = wb.addWorksheet("Test cases");
    sheet.columns = [
      { header: "Category", key: "category", width: 16 },
      { header: "Test case", key: "name", width: 44 },
      { header: "Type", key: "type", width: 10 },
      { header: "Status", key: "status", width: 10 },
      { header: "Severity", key: "severity", width: 10 },
      { header: "Expected result", key: "expected", width: 50 },
      { header: "Actual result", key: "actual", width: 60 },
      { header: "Duration (ms)", key: "duration", width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const tc of genericRows) {
      sheet.addRow({
        category: tc.category,
        name: tc.name,
        type: tc.testType,
        status: tc.result?.status ?? "—",
        severity: tc.result?.severity ?? "—",
        expected: tc.expectation ?? "—",
        actual: tc.result?.actual ?? "—",
        duration: tc.result?.durationMs ?? "—",
      });
    }
  }

  if (byCategory.stress.length) {
    const sheet = wb.addWorksheet("Stress");
    sheet.columns = [
      { header: "Test case", key: "name", width: 44 },
      { header: "Status", key: "status", width: 10 },
      { header: "Expected result", key: "expected", width: 50 },
      { header: "Concurrency", key: "concurrency", width: 12 },
      { header: "Requests", key: "requests", width: 10 },
      { header: "Error rate", key: "errorRate", width: 16 },
      { header: "Avg latency (ms)", key: "avg", width: 16 },
      { header: "P95 latency (ms)", key: "p95", width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const tc of byCategory.stress) {
      const m = tc.stressMetric;
      sheet.addRow({
        name: tc.name,
        status: tc.result?.status ?? "—",
        expected: tc.expectation ?? "—",
        concurrency: m?.concurrency ?? "—",
        requests: m?.totalRequests ?? "—",
        errorRate: m ? `${m.errorRatePct}% (${m.errorCount})` : "—",
        avg: m?.avgLatencyMs ?? "—",
        p95: m?.p95LatencyMs ?? "—",
      });
    }
  }

  if (byCategory.performance.length) {
    const sheet = wb.addWorksheet("Performance");
    sheet.columns = [
      { header: "Test case", key: "name", width: 44 },
      { header: "Status", key: "status", width: 10 },
      { header: "Expected result", key: "expected", width: 50 },
      { header: "DOMContentLoaded (ms)", key: "dcl", width: 20 },
      { header: "Load event (ms)", key: "load", width: 16 },
      { header: "Resources", key: "resources", width: 12 },
      { header: "Transfer size (KB)", key: "transfer", width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const tc of byCategory.performance) {
      const m = tc.performanceMetric;
      sheet.addRow({
        name: tc.name,
        status: tc.result?.status ?? "—",
        expected: tc.expectation ?? "—",
        dcl: m?.domContentLoadedMs ?? "—",
        load: m?.loadEventMs ?? "—",
        resources: m?.resourceCount ?? "—",
        transfer: m?.transferSizeKb ?? "—",
      });
    }
  }

  addFlowLikeSheet("Flows", byCategory.flow);
  addFlowLikeSheet("Custom stories", byCategory.story);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
