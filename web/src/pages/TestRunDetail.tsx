import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { TestRunDetail as TestRunDetailType, api } from "../api.js";

const CATEGORY_LABEL: Record<string, string> = {
  smoke: "Smoke tests",
  boundary: "Boundary value tests",
  vulnerability: "Vulnerability tests",
};

export default function TestRunDetail() {
  const { id } = useParams();
  const [run, setRun] = useState<TestRunDetailType | null>(null);

  useEffect(() => {
    if (!id) return;
    const load = () => api.getTestRun(id).then(setRun).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [id]);

  if (!run) return <p>Loading…</p>;

  const byCategory: Record<string, typeof run.testCases> = { smoke: [], boundary: [], vulnerability: [], stress: [] };
  for (const tc of run.testCases) byCategory[tc.category]?.push(tc);

  return (
    <div>
      <h2>Test run: {run.targetUrl}</h2>
      <div className="card">
        <p>
          Status: <span className={`badge ${run.status}`}>{run.status}</span>
        </p>
        <p>
          {run.passedCases} passed / {run.failedCases} failed / {run.errorCases} errors (of {run.totalCases} total)
        </p>
        {run.reportPath && (
          <p>
            <a className="link" href={`/reports/${run.reportPath}`} target="_blank" rel="noreferrer">
              Open full HTML report ↗
            </a>
          </p>
        )}
        {run.error && <p style={{ color: "#cf222e" }}>Error: {run.error}</p>}
      </div>

      {(["smoke", "boundary", "vulnerability"] as const).map((cat) =>
        byCategory[cat].length ? (
          <div className="card" key={cat}>
            <h3>{CATEGORY_LABEL[cat]} ({byCategory[cat].length})</h3>
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Status</th>
                  <th>Observed</th>
                  <th>Screenshot</th>
                </tr>
              </thead>
              <tbody>
                {byCategory[cat].map((tc) => (
                  <tr key={tc.id}>
                    <td>{tc.name}</td>
                    <td>{tc.result ? <span className={`badge ${tc.result.status}`}>{tc.result.status}</span> : "—"}</td>
                    <td>{tc.result?.actual ?? "—"}</td>
                    <td>
                      {tc.result?.screenshotPath ? (
                        <a href={`/screenshots/${tc.result.screenshotPath}`} target="_blank" rel="noreferrer">
                          <img
                            src={`/screenshots/${tc.result.screenshotPath}`}
                            alt="screenshot"
                            style={{ maxWidth: 100, border: "1px solid #ddd", borderRadius: 4 }}
                          />
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null,
      )}

      {byCategory.stress.length ? (
        <div className="card">
          <h3>Stress tests ({byCategory.stress.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Status</th>
                <th>Concurrency</th>
                <th>Requests</th>
                <th>Error rate</th>
                <th>Avg latency</th>
                <th>P95 latency</th>
              </tr>
            </thead>
            <tbody>
              {byCategory.stress.map((tc) => (
                <tr key={tc.id}>
                  <td>{tc.name}</td>
                  <td>{tc.result ? <span className={`badge ${tc.result.status}`}>{tc.result.status}</span> : "—"}</td>
                  <td>{tc.stressMetric?.concurrency ?? "—"}</td>
                  <td>{tc.stressMetric?.totalRequests ?? "—"}</td>
                  <td>
                    {tc.stressMetric ? `${tc.stressMetric.errorRatePct}% (${tc.stressMetric.errorCount})` : "—"}
                  </td>
                  <td>{tc.stressMetric ? `${tc.stressMetric.avgLatencyMs}ms` : "—"}</td>
                  <td>{tc.stressMetric ? `${tc.stressMetric.p95LatencyMs}ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
