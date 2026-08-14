import ExcelJS from "exceljs";
import { TestCaseReportFilters, TestCaseReportRow } from "../routes/reports.js";

export async function buildFilteredXlsxReport(
  testCases: TestCaseReportRow[],
  filters: TestCaseReportFilters,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AppTesting Agent";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Field", key: "field", width: 22 },
    { header: "Value", key: "value", width: 60 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRows([
    {
      field: "Date range",
      value:
        filters.dateFrom || filters.dateTo
          ? `${filters.dateFrom?.toISOString().slice(0, 10) ?? "…"} to ${filters.dateTo?.toISOString().slice(0, 10) ?? "…"}`
          : "All time",
    },
    { field: "Modules", value: filters.moduleNames.length ? filters.moduleNames.join(", ") : "All" },
    { field: "Total cases", value: testCases.length },
    { field: "Passed", value: testCases.filter((c) => c.result?.status === "pass").length },
    { field: "Failed", value: testCases.filter((c) => c.result?.status === "fail").length },
    { field: "Errors", value: testCases.filter((c) => c.result?.status === "error").length },
  ]);

  const sheet = wb.addWorksheet("Test cases");
  sheet.columns = [
    { header: "Target", key: "target", width: 34 },
    { header: "Project", key: "project", width: 20 },
    { header: "Module", key: "module", width: 24 },
    { header: "Category", key: "category", width: 16 },
    { header: "Type", key: "type", width: 10 },
    { header: "Test case", key: "name", width: 44 },
    { header: "Status", key: "status", width: 10 },
    { header: "Severity", key: "severity", width: 10 },
    { header: "Expected result", key: "expected", width: 50 },
    { header: "Actual result", key: "actual", width: 60 },
    { header: "Executed at", key: "executedAt", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const tc of testCases) {
    sheet.addRow({
      target: tc.testRun.targetUrl,
      project: tc.testRun.project?.name ?? "—",
      module: tc.module?.name ?? "—",
      category: tc.category,
      type: tc.testType,
      name: tc.name,
      status: tc.result?.status ?? "—",
      severity: tc.result?.severity ?? "—",
      expected: tc.expectation ?? "—",
      actual: tc.result?.actual ?? "—",
      executedAt: tc.result ? new Date(tc.result.createdAt).toISOString() : "—",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
