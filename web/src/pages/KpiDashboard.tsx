import { useEffect, useState } from "react";
import { AccountKpi, AgentPerformanceKpi, api } from "../api.js";

export default function KpiDashboard() {
  const [accountKpis, setAccountKpis] = useState<AccountKpi[]>([]);
  const [agentKpi, setAgentKpi] = useState<AgentPerformanceKpi | null>(null);

  useEffect(() => {
    const load = () => {
      api.accountKpis().then(setAccountKpis).catch(() => {});
      api.agentKpi().then(setAgentKpi).catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <h2>KPI dashboard</h2>

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
                <td>{k.lastRunAt ? new Date(k.lastRunAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {!accountKpis.length && (
              <tr>
                <td colSpan={9}>No account activity yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
