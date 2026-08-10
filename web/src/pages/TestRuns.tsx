import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TestRun, api } from "../api.js";

export default function TestRuns() {
  const [runs, setRuns] = useState<TestRun[]>([]);

  useEffect(() => {
    const load = () => api.listTestRuns().then(setRuns).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <h2>Test runs</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Account</th>
              <th>Status</th>
              <th>Pass / Fail / Error</th>
              <th>Started</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.targetUrl}</td>
                <td>{r.account?.label ?? "—"}</td>
                <td>
                  <span className={`badge ${r.status}`}>{r.status}</span>
                </td>
                <td>
                  {r.passedCases} / {r.failedCases} / {r.errorCases} (of {r.totalCases})
                </td>
                <td>{new Date(r.startedAt).toLocaleString()}</td>
                <td>
                  <Link className="link" to={`/runs/${r.id}`}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {!runs.length && (
              <tr>
                <td colSpan={6}>No test runs yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
