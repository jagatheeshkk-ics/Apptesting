import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function statusBadge(status: string): string {
  const color = status === "pass" ? "#1a7f37" : status === "fail" ? "#cf222e" : "#9a6700";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:${color}">${status.toUpperCase()}</span>`;
}

export async function buildHtmlReport(testRunId: string, reportDir: string, screenshotDir: string): Promise<string> {
  const run = await prisma.testRun.findUniqueOrThrow({
    where: { id: testRunId },
    include: {
      account: true,
      testCases: { include: { result: true, module: true } },
    },
  });

  const byCategory: Record<string, typeof run.testCases> = { smoke: [], boundary: [], vulnerability: [] };
  for (const tc of run.testCases) byCategory[tc.category]?.push(tc);

  const vulnFindings = byCategory.vulnerability.filter((tc) => tc.result?.status === "fail");

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
          <td>${r ? statusBadge(r.status) : "—"}</td>
          <td>${r?.severity ? escapeHtml(r.severity) : "—"}</td>
          <td>${escapeHtml(r?.actual ?? "")}</td>
          <td>${r ? `${r.durationMs}ms` : "—"}</td>
          <td>${screenshotTag}</td>
        </tr>`;
      })
      .join("\n");
    return `
      <h2>${title} (${cases.length})</h2>
      <table>
        <thead><tr><th>Test case</th><th>Status</th><th>Severity</th><th>Observed behavior</th><th>Duration</th><th>Screenshot</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
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
</style>
</head>
<body>
  <h1>Application Test Report</h1>
  <div class="meta">
    Target: <strong>${escapeHtml(run.targetUrl)}</strong><br/>
    Account: ${run.account ? escapeHtml(run.account.label) + " (" + escapeHtml(run.account.role ?? "n/a") + ")" : "None (anonymous)"}<br/>
    Run started: ${run.startedAt.toISOString()}<br/>
    Run completed: ${run.completedAt?.toISOString() ?? "—"}
  </div>

  <div class="summary">
    <div class="stat"><div class="n">${run.totalCases}</div><div class="l">Total cases</div></div>
    <div class="stat"><div class="n" style="color:#1a7f37">${run.passedCases}</div><div class="l">Passed</div></div>
    <div class="stat"><div class="n" style="color:#cf222e">${run.failedCases}</div><div class="l">Failed</div></div>
    <div class="stat"><div class="n" style="color:#9a6700">${run.errorCases}</div><div class="l">Errors</div></div>
    <div class="stat"><div class="n">${vulnFindings.length}</div><div class="l">Vulnerability findings</div></div>
  </div>

  ${
    vulnFindings.length
      ? `<div class="findings"><strong>⚠ ${vulnFindings.length} potential vulnerability finding(s) require review.</strong></div>`
      : ""
  }

  ${sectionHtml("Smoke tests", byCategory.smoke)}
  ${sectionHtml("Boundary value tests", byCategory.boundary)}
  ${sectionHtml("Vulnerability tests", byCategory.vulnerability)}
</body>
</html>`;

  await fs.mkdir(reportDir, { recursive: true });
  const filename = `${testRunId}.html`;
  await fs.writeFile(path.join(reportDir, filename), html, "utf-8");
  return filename;
}
