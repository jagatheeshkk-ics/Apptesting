import { useEffect, useState } from "react";
import { AccountKpi, AgentPerformanceKpi, DashboardSummary, TEST_CATEGORY_LABELS, api } from "../api.js";

export default function KpiDashboard() {
  const [accountKpis, setAccountKpis] = useState<AccountKpi[]>([]);
  const [agentKpi, setAgentKpi] = useState<AgentPerformanceKpi | null>(null);

  const [projectId, setProjectId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState<"day" | "week">("day");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    const load = () => {
      api.accountKpis().then(setAccountKpis).catch(() => {});
      api.agentKpi().then(setAgentKpi).catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const load = () =>
      api
        .dashboardSummary({ projectId: projectId || undefined, accountId: accountId || undefined, from: from || undefined, to: to || undefined, groupBy })
        .then(setSummary)
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [projectId, accountId, from, to, groupBy]);

  return (
    <div>
      <h2>KPI dashboard</h2>

      <div className="card">
        <h3>Overview</h3>
        <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label>Project</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              <option value="unassigned">Unassigned</option>
              {summary?.filterOptions.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Account (user)</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All accounts</option>
              {summary?.filterOptions.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label>Trend grouping</label>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as "day" | "week")}>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
            </select>
          </div>
          {(projectId || accountId || from || to) && (
            <button
              type="button"
              onClick={() => {
                setProjectId("");
                setAccountId("");
                setFrom("");
                setTo("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {summary && (
          <>
            <div className="kpi-grid" style={{ marginTop: 16 }}>
              <div className="kpi-tile">
                <div className="n">{summary.totalRuns}</div>
                <div className="l">Total test runs</div>
              </div>
              <div className="kpi-tile">
                <div className="n">{summary.totalCases}</div>
                <div className="l">Total test cases</div>
              </div>
              <div className="kpi-tile">
                <div className="n">{(summary.passRate * 100).toFixed(0)}%</div>
                <div className="l">Pass rate</div>
              </div>
              <div className="kpi-tile">
                <div className="n">{summary.totalIssues}</div>
                <div className="l">Total issues (fail + error)</div>
              </div>
            </div>

            <h4 style={{ marginTop: 20 }}>Issues by test type</h4>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Total cases</th>
                  <th>Passed</th>
                  <th>Failed</th>
                  <th>Errored</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {summary.issuesByCategory.map((c) => (
                  <tr key={c.category}>
                    <td>{TEST_CATEGORY_LABELS[c.category]}</td>
                    <td>{c.totalCases}</td>
                    <td>{c.passedCases}</td>
                    <td>{c.failedCases}</td>
                    <td>{c.errorCases}</td>
                    <td>
                      <strong>{c.issues}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4 style={{ marginTop: 20 }}>{groupBy === "week" ? "Weekly" : "Daily"} trend</h4>
            <table>
              <thead>
                <tr>
                  <th>{groupBy === "week" ? "Week of" : "Date"}</th>
                  <th>Runs</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {summary.trend.map((t) => (
                  <tr key={t.period}>
                    <td>{t.period}</td>
                    <td>{t.runs}</td>
                    <td>{t.issues}</td>
                  </tr>
                ))}
                {!summary.trend.length && (
                  <tr>
                    <td colSpan={3}>No test runs in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h3>Agent / system performance</h3>
        {agentKpi && (
          <div className="kpi-grid">
            <div className="kpi-tile">
              <div className="n">{agentKpi.totalRuns}</div>
              <div className="l">Total runs</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.completedRuns}</div>
              <div className="l">Completed</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.failedRuns}</div>
              <div className="l">Failed to run</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.avgRunDurationMs ? `${Math.round(agentKpi.avgRunDurationMs / 1000)}s` : "—"}</div>
              <div className="l">Avg run duration</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.totalVulnerabilitiesFound}</div>
              <div className="l">Vulnerabilities found</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.totalStressTests}</div>
              <div className="l">Stress tests run</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.avgStressErrorRatePct != null ? `${agentKpi.avgStressErrorRatePct}%` : "—"}</div>
              <div className="l">Avg error rate under load</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.avgStressP95LatencyMs != null ? `${agentKpi.avgStressP95LatencyMs}ms` : "—"}</div>
              <div className="l">Avg P95 latency under load</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.totalPerformanceIssues}</div>
              <div className="l">Performance issues found</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.totalAccessibilityIssues}</div>
              <div className="l">Accessibility issues found</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.totalFlowRuns}</div>
              <div className="l">Flow tests run</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{agentKpi.flowPassRate != null ? `${Math.round(agentKpi.flowPassRate * 100)}%` : "—"}</div>
              <div className="l">Flow pass rate</div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Per-account KPIs (logged-in users)</h3>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Role</th>
              <th>Runs</th>
              <th>Cases</th>
              <th>Pass rate</th>
              <th>Vulnerabilities</th>
              <th>Avg response</th>
              <th>Errors seen</th>
              <th>Stress error rate</th>
              <th>Stress P95 latency</th>
              <th>Perf issues</th>
              <th>A11y issues</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {accountKpis.map((k) => (
              <tr key={k.accountId}>
                <td>{k.label}</td>
                <td>{k.role ?? "—"}</td>
                <td>{k.totalRuns}</td>
                <td>{k.totalCases}</td>
                <td>{(k.passRate * 100).toFixed(0)}%</td>
                <td>{k.vulnerabilitiesFound}</td>
                <td>{k.avgResponseMs ? `${k.avgResponseMs}ms` : "—"}</td>
                <td>{k.errorEventCount}</td>
                <td>{k.avgStressErrorRatePct != null ? `${k.avgStressErrorRatePct}%` : "—"}</td>
                <td>{k.avgStressP95LatencyMs != null ? `${k.avgStressP95LatencyMs}ms` : "—"}</td>
                <td>{k.performanceIssuesFound}</td>
                <td>{k.accessibilityIssuesFound}</td>
                <td>{k.lastRunAt ? new Date(k.lastRunAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {!accountKpis.length && (
              <tr>
                <td colSpan={13}>No account activity yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
