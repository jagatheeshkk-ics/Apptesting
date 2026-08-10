import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Account, api } from "../api.js";

export default function NewTestRun() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [targetUrl, setTargetUrl] = useState("");
  const [accountId, setAccountId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => {});
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const run = await api.createTestRun({ targetUrl, accountId: accountId || undefined });
      navigate(`/runs/${run.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2>Start a new test run</h2>
      <p>
        Enter a URL. The agent will crawl the application, identify modules (pages, forms, fields), and run
        smoke, boundary-value, and vulnerability tests automatically.
      </p>
      <div className="card">
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label>Target URL</label>
            <input
              type="url"
              required
              placeholder="https://example.com"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label>Login account (optional)</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">None — test anonymously</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.role ?? "no role"})
                </option>
              ))}
            </select>
          </div>
          {error && <p style={{ color: "#cf222e" }}>{error}</p>}
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? "Starting…" : "Start test run"}
          </button>
        </form>
      </div>
    </div>
  );
}
