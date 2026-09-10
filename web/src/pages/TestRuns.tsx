import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TestRun, api } from "../api.js";

// Statuses during which the Stop control is shown at all — mirrors
// TestRunDetail.tsx's STOPPABLE_STATUSES. "cancelling" is included so the
// button stays visible (disabled) while a stop request is winding down.
const STOPPABLE_STATUSES = ["pending", "crawling", "generating", "executing", "cancelling"];

export default function TestRuns() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [stopError, setStopError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.listTestRuns().then(setRuns).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  async function handleStop(id: string) {
    setStoppingIds((prev) => new Set(prev).add(id));
    setStopError(null);
    try {
      const updated = await api.stopTestRun(id);
      setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, status: updated.status } : r)));
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to stop the run.");
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div>
      <h2>Test runs</h2>
      {stopError && <p style={{ color: "#cf222e" }}>{stopError}</p>}
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Account</th>
              <th>Project</th>
              <th>Status</th>
              <th>Pass / Fail / Error</th>
              <th>Started</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td style={{ maxWidth: 420, wordBreak: "break-all" }} title={r.targetUrl}>
                  {r.targetUrl}
                </td>
                <td>{r.account?.label ?? "—"}</td>
                <td>{r.project?.name ?? "—"}</td>
                <td>
                  <span className={`badge ${r.status}`}>{r.status}</span>
                </td>
                <td>
                  {r.passedCases} / {r.failedCases} / {r.errorCases} (of {r.totalCases})
                </td>
                <td>{new Date(r.startedAt).toLocaleString()}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Link className="link" to={`/runs/${r.id}`}>
                    View
                  </Link>
                  {STOPPABLE_STATUSES.includes(r.status) && (
                    <>
                      {" "}
                      &nbsp;
                      <button
                        type="button"
                        onClick={() => handleStop(r.id)}
                        disabled={stoppingIds.has(r.id) || r.status === "cancelling"}
                      >
                        {stoppingIds.has(r.id) || r.status === "cancelling" ? "Stopping…" : "Stop"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!runs.length && (
              <tr>
                <td colSpan={7}>No test runs yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
