import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { RegressionSummary } from "../analysis/regression.js";
import { escapeHtml, statusBadge, testTypeBadge } from "./htmlHelpers.js";
import { ALL_TEST_CATEGORIES, TEST_CATEGORY_LABELS, TestCategory } from "../types.js";

// "Full" when every category was selected (or no filter was applied at
// all); otherwise the specific test types the user picked, so the report
// doesn't just say "full" when it was actually a filtered run.
export function testTypesLabel(enabledCategoriesJson: string | null): string {
  const enabled = enabledCategoriesJson ? (JSON.parse(enabledCategoriesJson) as TestCategory[]) : null;
  if (!enabled || enabled.length >= ALL_TEST_CATEGORIES.length) return "Full";
  return enabled.map((c) => TEST_CATEGORY_LABELS[c] ?? c).join(", ");
}

export async function buildHtmlReport(testRunId: string, reportDir: string, screenshotDir: string): Promise<string> {
  const run = await prisma.testRun.findUniqueOrThrow({
    where: { id: testRunId },
    include: {
      modules: true,
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
    },
  });

  const byCategory: Record<string, typeof run.testCases> = {
    smoke: [],
    boundary: [],
    vulnerability: [],
    stress: [],
    performance: [],
    compatibility: [],
    accessibility: [],
    flow: [],
  };
  for (const tc of run.testCases) byCategory[tc.category]?.push(tc);

  const vulnFindings = byCategory.vulnerability.filter((tc) => tc.result?.status === "fail");
  const stressFindings = byCategory.stress.filter((tc) => tc.result?.status === "fail");

  const regressions: RegressionSummary | null = run.regressionsJson ? JSON.parse(run.regressionsJson) : null;

  const sectionHtml = (title: string, cases: typeof run.testCases) => {
    if (!cases.length) return "";
    const rows = cases
      .map((tc) => {
        const r = tc.result;
        const screenshotTag = r?.screenshotPath
          ? `<a href="../screenshots/${r.screenshotPath}" target="_blank"><img src="../screenshots/${r.screenshotPath}" style="max-width:120px;border:1px solid #ddd;border-radius:4px" /></a>`
          : "—";
        return `<tr>
          <td>${escapeHtml(tc.name)}</td>
          <td>${testTypeBadge(tc.testType)}</td>
          <td>${r ? statusBadge(r.status) : "—"}</td>
          <td>${r?.severity ? escapeHtml(r.severity) : "—"}</td>
          <td>${escapeHtml(tc.expectation ?? "—")}</td>
          <td>${escapeHtml(r?.actual ?? "")}</td>
          <td>${r ? `${r.durationMs}ms` : "—"}</td>
          <td>${screenshotTag}</td>
        </tr>`;
      })
      .join("\n");
    return `
      <h2>${title} (${cases.length})</h2>
      <table>
        <thead><tr><th>Test case</th><th>Type</th><th>Status</th><th>Severity</th><th>Expected result</th><th>Actual result</th><th>Duration</th><th>Screenshot</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  };

  const stressSectionHtml = (cases: typeof run.testCases) => {
    if (!cases.length) return "";
    const rows = cases
      .map((tc) => {
        const r = tc.result;
        const m = tc.stressMetric;
        return `<tr>
          <td>${escapeHtml(tc.name)}</td>
          <td>${r ? statusBadge(r.status) : "—"}</td>
          <td>${escapeHtml(tc.expectation ?? "—")}</td>
          <td>${m?.concurrency ?? "—"}</td>
          <td>${m?.totalRequests ?? "—"}</td>
          <td>${m ? `${m.errorRatePct}% (${m.errorCount})` : "—"}</td>
          <td>${m ? `${m.avgLatencyMs}ms` : "—"}</td>
          <td>${m ? `${m.p95LatencyMs}ms` : "—"}</td>
        </tr>`;
      })
      .join("\n");
    return `
      <h2>Stress tests (${cases.length})</h2>
      <table>
        <thead><tr><th>Test case</th><th>Status</th><th>Expected result</th><th>Concurrency</th><th>Requests</th><th>Error rate</th><th>Avg latency</th><th>P95 latency</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  };

  const performanceSectionHtml = (cases: typeof run.testCases) => {
    if (!cases.length) return "";
    const rows = cases
      .map((tc) => {
        const r = tc.result;
        const m = tc.performanceMetric;
        return `<tr>
          <td>${escapeHtml(tc.name)}</td>
          <td>${r ? statusBadge(r.status) : "—"}</td>
          <td>${escapeHtml(tc.expectation ?? "—")}</td>
          <td>${m ? `${m.domContentLoadedMs}ms` : "—"}</td>
          <td>${m ? `${m.loadEventMs}ms` : "—"}</td>
          <td>${m ? `${m.resourceCount}` : "—"}</td>
          <td>${m ? `${m.transferSizeKb}KB` : "—"}</td>
        </tr>`;
      })
      .join("\n");
    return `
      <h2>Performance tests (${cases.length})</h2>
      <table>
        <thead><tr><th>Test case</th><th>Status</th><th>Expected result</th><th>DOMContentLoaded</th><th>Load event</th><th>Resources</th><th>Transfer size</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  };

  const flowSectionHtml = (cases: typeof run.testCases) => {
    if (!cases.length) return "";
    const blocks = cases
      .map((tc) => {
        const r = tc.result;
        const steps = tc.flowStepResults
          .map(
            (s) => `<tr>
          <td>${s.order + 1}</td>
          <td>${escapeHtml(s.action)}</td>
          <td>${statusBadge(s.status)}</td>
          <td>${escapeHtml(s.detail)}</td>
          <td>${
            s.screenshotPath
              ? `<a href="../screenshots/${s.screenshotPath}" target="_blank"><img src="../screenshots/${s.screenshotPath}" style="max-width:100px;border:1px solid #ddd;border-radius:4px" /></a>`
              : "—"
          }</td>
        </tr>`,
          )
          .join("\n");
        return `
        <h3>${escapeHtml(tc.name)} ${r ? statusBadge(r.status) : ""}</h3>
        <p style="color:#59636e"><strong>Expected:</strong> ${escapeHtml(tc.expectation ?? "—")}</p>
        <p style="color:#59636e"><strong>Actual:</strong> ${escapeHtml(r?.actual ?? "")}</p>
        <table>
          <thead><tr><th>#</th><th>Action</th><th>Status</th><th>Detail</th><th>Screenshot</th></tr></thead>
          <tbody>${steps}</tbody>
        </table>`;
      })
      .join("\n");
    return `<h2>Flow tests (${cases.length})</h2>${blocks}`;
  };

  const regressionHtml = () => {
    if (!regressions || !regressions.previousRunId) return "";
    const list = (title: string, entries: RegressionSummary["regressed"]) =>
      entries.length
        ? `<h3>${title} (${entries.length})</h3><ul>${entries
            .map((e) => `<li>[${escapeHtml(e.category)}] ${escapeHtml(e.name)}: ${e.previousStatus} → ${e.currentStatus}</li>`)
            .join("")}</ul>`
        : "";
    if (!regressions.regressed.length && !regressions.fixed.length) return "";
    return `
      <div class="findings" style="background:#fff8f6;border-color:${regressions.regressed.length ? "#ffb3a3" : "#a3d9a5"}">
        <strong>Regression check vs. previous run</strong>
        ${list("Regressed (previously passing, now failing)", regressions.regressed)}
        ${list("Fixed since last run", regressions.fixed)}
      </div>`;
  };

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Test Report — ${escapeHtml(run.targetUrl)}</title>
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
  .findings { background: #fff8f6; border: 1px solid #ffb3a3; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
  .findings ul { margin: 4px 0; padding-left: 20px; font-size: 13px; }
</style>
</head>
<body>
  <h1>Application Test Report</h1>
  <div class="meta">
    ${run.modules.length ? `Module(s): <strong>${run.modules.map((m) => escapeHtml(m.name)).join(", ")}</strong><br/>` : ""}
    Target: <strong>${escapeHtml(run.targetUrl)}</strong><br/>
    Run by: ${run.createdByUsername ? escapeHtml(run.createdByUsername) : "Unknown"}<br/>
    Mode: ${run.mode === "quick" ? "Quick/sanity — " : ""}${escapeHtml(testTypesLabel(run.enabledCategoriesJson))}<br/>
    Run started: ${run.startedAt.toISOString()}<br/>
    Run completed: ${run.completedAt?.toISOString() ?? "—"}
  </div>

  <div class="summary">
    <div class="stat"><div class="n">${run.totalCases}</div><div class="l">Total cases</div></div>
    <div class="stat"><div class="n" style="color:#1a7f37">${run.passedCases}</div><div class="l">Passed</div></div>
    <div class="stat"><div class="n" style="color:#cf222e">${run.failedCases}</div><div class="l">Failed</div></div>
    <div class="stat"><div class="n" style="color:#9a6700">${run.errorCases}</div><div class="l">Errors</div></div>
    <div class="stat"><div class="n">${vulnFindings.length}</div><div class="l">Vulnerability findings</div></div>
    <div class="stat"><div class="n">${stressFindings.length}</div><div class="l">Stress findings</div></div>
  </div>

  ${
    vulnFindings.length
      ? `<div class="findings"><strong>⚠ ${vulnFindings.length} potential vulnerability finding(s) require review.</strong></div>`
      : ""
  }
  ${
    stressFindings.length
      ? `<div class="findings"><strong>⚠ ${stressFindings.length} module(s) showed elevated error rate or latency under concurrent load.</strong></div>`
      : ""
  }
  ${regressionHtml()}

  ${sectionHtml("Smoke tests", byCategory.smoke)}
  ${sectionHtml("Boundary value tests", byCategory.boundary)}
  ${sectionHtml("Vulnerability tests", byCategory.vulnerability)}
  ${stressSectionHtml(byCategory.stress)}
  ${performanceSectionHtml(byCategory.performance)}
  ${sectionHtml("Compatibility tests", byCategory.compatibility)}
  ${sectionHtml("Accessibility tests", byCategory.accessibility)}
  ${flowSectionHtml(byCategory.flow)}
</body>
</html>`;

  await fs.mkdir(reportDir, { recursive: true });
  const filename = `${testRunId}.html`;
  await fs.writeFile(path.join(reportDir, filename), html, "utf-8");
  return filename;
}
