import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { TestRunDetail as TestRunDetailType, api } from "../api.js";

const CATEGORY_LABEL: Record<string, string> = {
  smoke: "Smoke tests",
  boundary: "Boundary value tests",
  vulnerability: "Vulnerability tests",
  compatibility: "Compatibility tests",
  accessibility: "Accessibility tests",
};

const GENERIC_CATEGORIES = ["smoke", "boundary", "vulnerability", "compatibility", "accessibility"] as const;

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

  const regressions = run.regressions;

  return (
    <div>
      <h2>Test run: {run.targetUrl}</h2>
      <div className="card">
        <p>
          Status: <span className={`badge ${run.status}`}>{run.status}</span> &nbsp; Mode: <strong>{run.mode}</strong>
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

      {!!run.modules?.length && (
        <div className="card">
          <h3>Modules &amp; user stories</h3>
          {run.modules.map((m) => (
            <div key={m.id} style={{ marginBottom: 14 }}>
              <strong>
                {m.name} <span style={{ fontWeight: 400, color: "#59636e" }}>({m.type})</span>
              </strong>
              {m.userStories.length ? (
                <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                  {m.userStories.map((s, i) => (
                    <li key={i} style={{ fontSize: 13 }}>
                      {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: "4px 0 0", color: "#59636e", fontSize: 13 }}>No user stories recorded.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {regressions && regressions.previousRunId && (regressions.regressed.length || regressions.fixed.length) ? (
        <div className="card">
          <h3>Regression check vs. previous run</h3>
          {regressions.regressed.length > 0 && (
            <>
              <p style={{ color: "#cf222e", fontWeight: 600 }}>
                {regressions.regressed.length} case(s) regressed (previously passing, now failing):
              </p>
              <ul>
                {regressions.regressed.map((r, i) => (
                  <li key={i}>
                    [{r.category}] {r.name}: {r.previousStatus} → {r.currentStatus}
                  </li>
                ))}
              </ul>
            </>
          )}
          {regressions.fixed.length > 0 && (
            <>
              <p style={{ color: "#1a7f37", fontWeight: 600 }}>{regressions.fixed.length} case(s) fixed since last run:</p>
              <ul>
                {regressions.fixed.map((r, i) => (
                  <li key={i}>
                    [{r.category}] {r.name}: {r.previousStatus} → {r.currentStatus}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {GENERIC_CATEGORIES.map((cat) =>
        byCategory[cat].length ? (
          <div className="card" key={cat}>
            <h3>{CATEGORY_LABEL[cat]} ({byCategory[cat].length})</h3>
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Expected result</th>
                  <th>Actual result</th>
                  <th>Screenshot</th>
                </tr>
              </thead>
              <tbody>
                {byCategory[cat].map((tc) => (
                  <tr key={tc.id}>
                    <td>{tc.name}</td>
                    <td>
                      <span className={`badge ${tc.testType}`}>{tc.testType}</span>
                    </td>
                    <td>{tc.result ? <span className={`badge ${tc.result.status}`}>{tc.result.status}</span> : "—"}</td>
                    <td>{tc.expectation ?? "—"}</td>
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
                <th>Expected result</th>
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
                  <td>{tc.expectation ?? "—"}</td>
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

      {byCategory.performance.length ? (
        <div className="card">
          <h3>Performance tests ({byCategory.performance.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Status</th>
                <th>Expected result</th>
                <th>DOMContentLoaded</th>
                <th>Load event</th>
                <th>Resources</th>
                <th>Transfer size</th>
              </tr>
            </thead>
            <tbody>
              {byCategory.performance.map((tc) => (
                <tr key={tc.id}>
                  <td>{tc.name}</td>
                  <td>{tc.result ? <span className={`badge ${tc.result.status}`}>{tc.result.status}</span> : "—"}</td>
                  <td>{tc.expectation ?? "—"}</td>
                  <td>{tc.performanceMetric ? `${tc.performanceMetric.domContentLoadedMs}ms` : "—"}</td>
                  <td>{tc.performanceMetric ? `${tc.performanceMetric.loadEventMs}ms` : "—"}</td>
                  <td>{tc.performanceMetric?.resourceCount ?? "—"}</td>
                  <td>{tc.performanceMetric ? `${tc.performanceMetric.transferSizeKb}KB` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {byCategory.flow.length ? (
        <div className="card">
          <h3>Flow tests ({byCategory.flow.length})</h3>
          {byCategory.flow.map((tc) => (
            <div key={tc.id} style={{ marginBottom: 20 }}>
              <p>
                <strong>{tc.name}</strong>{" "}
                {tc.result ? <span className={`badge ${tc.result.status}`}>{tc.result.status}</span> : null}
              </p>
              <p style={{ color: "#59636e", fontSize: 13 }}>
                <strong>Expected:</strong> {tc.expectation ?? "—"}
              </p>
              <p style={{ color: "#59636e", fontSize: 13 }}>
                <strong>Actual:</strong> {tc.result?.actual}
              </p>
              {tc.flowStepResults?.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Action</th>
                      <th>Status</th>
                      <th>Detail</th>
                      <th>Screenshot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tc.flowStepResults.map((s) => (
                      <tr key={s.order}>
                        <td>{s.order + 1}</td>
                        <td>{s.action}</td>
                        <td>
                          <span className={`badge ${s.status}`}>{s.status}</span>
                        </td>
                        <td>{s.detail}</td>
                        <td>
                          {s.screenshotPath ? (
                            <a href={`/screenshots/${s.screenshotPath}`} target="_blank" rel="noreferrer">
                              <img
                                src={`/screenshots/${s.screenshotPath}`}
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
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
