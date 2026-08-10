import { escapeHtml, statusBadge } from "./htmlHelpers.js";
import { TestCaseReportFilters, TestCaseReportRow } from "../routes/reports.js";

export function buildFilteredHtmlReport(testCases: TestCaseReportRow[], filters: TestCaseReportFilters): string {
  const passed = testCases.filter((c) => c.result?.status === "pass").length;
  const failed = testCases.filter((c) => c.result?.status === "fail").length;
  const errored = testCases.filter((c) => c.result?.status === "error").length;

  const filterLine = [
    filters.dateFrom || filters.dateTo
      ? `Date range: ${filters.dateFrom?.toISOString().slice(0, 10) ?? "…"} to ${filters.dateTo?.toISOString().slice(0, 10) ?? "…"}`
      : "Date range: all time",
    filters.moduleNames.length ? `Modules: ${filters.moduleNames.map(escapeHtml).join(", ")}` : "Modules: all",
  ].join(" &nbsp;|&nbsp; ");

  const rows = testCases
    .map((tc) => {
      const r = tc.result;
      return `<tr>
        <td>${escapeHtml(tc.testRun.targetUrl)}</td>
        <td>${tc.testRun.project ? escapeHtml(tc.testRun.project.name) : "—"}</td>
        <td>${tc.module ? escapeHtml(tc.module.name) : "—"}</td>
        <td>${escapeHtml(tc.category)}</td>
        <td>${escapeHtml(tc.name)}</td>
        <td>${r ? statusBadge(r.status) : "—"}</td>
        <td>${r?.severity ? escapeHtml(r.severity) : "—"}</td>
        <td>${escapeHtml(r?.actual ?? "")}</td>
        <td>${r ? new Date(r.createdAt).toISOString() : "—"}</td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Test Case Results Report</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 32px; color: #1f2328; }
  h1 { margin-bottom: 4px; }
  .meta { color: #59636e; margin-bottom: 24px; }
  .summary { display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
  .stat { border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 20px; min-width: 120px; }
  .stat .n { font-size: 28px; font-weight: 700; }
  .stat .l { font-size: 12px; color: #59636e; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eaeef2; font-size: 13px; vertical-align: top; }
  th { background: #f6f8fa; }
</style>
</head>
<body>
  <h1>Test Case Results Report</h1>
  <div class="meta">
    Generated: ${new Date().toISOString()}<br/>
    ${filterLine}
  </div>

  <div class="summary">
    <div class="stat"><div class="n">${testCases.length}</div><div class="l">Total cases</div></div>
    <div class="stat"><div class="n" style="color:#1a7f37">${passed}</div><div class="l">Passed</div></div>
    <div class="stat"><div class="n" style="color:#cf222e">${failed}</div><div class="l">Failed</div></div>
    <div class="stat"><div class="n" style="color:#9a6700">${errored}</div><div class="l">Errors</div></div>
  </div>

  <table>
    <thead>
      <tr><th>Target</th><th>Project</th><th>Module</th><th>Category</th><th>Test case</th><th>Status</th><th>Severity</th><th>Observed behavior</th><th>Executed at</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}
