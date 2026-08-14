import { FormEvent, useEffect, useState } from "react";
import { TestCaseReportSummary, api } from "../api.js";

export default function Reports() {
  const [availableModules, setAvailableModules] = useState<string[]>([]);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [summary, setSummary] = useState<TestCaseReportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listReportModules().then(setAvailableModules).catch(() => {});
  }, []);

  function toggleModule(name: string) {
    setSelectedModules((sel) => (sel.includes(name) ? sel.filter((m) => m !== name) : [...sel, name]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.searchTestCaseReport({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        modules: selectedModules,
      });
      setSummary(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const exportUrl = api.reportExportUrl({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    modules: selectedModules,
  });
  const exportXlsxUrl = api.reportExportXlsxUrl({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    modules: selectedModules,
  });

  return (
    <div>
      <h2>Test case results report</h2>
      <p>Search test case results by date and module — pick a single module or several to consolidate the report.</p>

      <div className="card">
        <form onSubmit={onSubmit}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div className="form-row">
              <label>From date</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="form-row">
              <label>To date</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <label>
              Modules ({selectedModules.length ? `${selectedModules.length} selected` : "all"})
            </label>
            <div
              style={{
                border: "1px solid #d0d7de",
                borderRadius: 8,
                padding: 10,
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {availableModules.map((m) => (
                <label key={m} style={{ display: "block", fontWeight: 400, padding: "2px 0" }}>
                  <input
                    type="checkbox"
                    checked={selectedModules.includes(m)}
                    onChange={() => toggleModule(m)}
                    style={{ marginRight: 8 }}
                  />
                  {m}
                </label>
              ))}
              {!availableModules.length && <p style={{ margin: 0, color: "#59636e" }}>No modules discovered yet.</p>}
            </div>
            {!!selectedModules.length && (
              <button type="button" onClick={() => setSelectedModules([])} style={{ marginTop: 6, background: "none", border: "none", color: "#59636e", cursor: "pointer" }}>
                Clear selection
              </button>
            )}
          </div>

          {error && <p style={{ color: "#cf222e" }}>{error}</p>}
          <button className="primary" type="submit" disabled={loading}>
            {loading ? "Searching…" : "Generate report"}
          </button>
          {summary && (
            <>
              <a className="link" href={exportUrl} style={{ marginLeft: 12 }}>
                Download as HTML
              </a>
              <a className="link" href={exportXlsxUrl} style={{ marginLeft: 12 }}>
                Download as Excel
              </a>
            </>
          )}
        </form>
      </div>

      {summary && (
        <div className="card">
          <div className="kpi-grid">
            <div className="kpi-tile">
              <div className="n">{summary.totalCases}</div>
              <div className="l">Total cases</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{summary.passedCases}</div>
              <div className="l">Passed</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{summary.failedCases}</div>
              <div className="l">Failed</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{summary.errorCases}</div>
              <div className="l">Errors</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Project</th>
                <th>Module</th>
                <th>Category</th>
                <th>Type</th>
                <th>Test case</th>
                <th>Status</th>
                <th>Severity</th>
                <th>Expected result</th>
                <th>Actual result</th>
                <th>Executed at</th>
              </tr>
            </thead>
            <tbody>
              {summary.testCases.map((tc) => (
                <tr key={tc.id}>
                  <td>{tc.testRun.targetUrl}</td>
                  <td>{tc.testRun.project?.name ?? "—"}</td>
                  <td>{tc.module?.name ?? "—"}</td>
                  <td>{tc.category}</td>
                  <td>
                    <span className={`badge ${tc.testType}`}>{tc.testType}</span>
                  </td>
                  <td>{tc.name}</td>
                  <td>
                    <span className={`badge ${tc.result?.status ?? ""}`}>{tc.result?.status ?? "—"}</span>
                  </td>
                  <td>{tc.result?.severity ?? "—"}</td>
                  <td>{tc.expectation ?? "—"}</td>
                  <td>{tc.result?.actual ?? "—"}</td>
                  <td>{tc.result ? new Date(tc.result.createdAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {!summary.testCases.length && (
                <tr>
                  <td colSpan={11}>No test case results match this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
