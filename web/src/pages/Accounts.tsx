import { FormEvent, useEffect, useState } from "react";
import { Account, api } from "../api.js";

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [label, setLabel] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.listAccounts().then(setAccounts).catch(() => {});
  }

  useEffect(load, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createAccount({ label, targetUrl, username, password, role: role || undefined });
      setLabel("");
      setTargetUrl("");
      setUsername("");
      setPassword("");
      setRole("");
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDelete(id: string) {
    await api.deleteAccount(id);
    load();
  }

  return (
    <div>
      <h2>Login accounts</h2>
      <p>
        Register test accounts the agent can log in with while testing. Use dedicated test/QA credentials, not
        real production accounts — credentials are stored so the agent can re-submit them during automated runs.
      </p>
      <div className="card">
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label>Label</label>
            <input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Admin QA account" />
          </div>
          <div className="form-row">
            <label>Target URL</label>
            <input
              required
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com/login"
            />
          </div>
          <div className="form-row">
            <label>Username / email</label>
            <input required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Password</label>
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Role (optional)</label>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="admin, standard-user…" />
          </div>
          {error && <p style={{ color: "#cf222e" }}>{error}</p>}
          <button className="primary" type="submit">
            Add account
          </button>
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Target</th>
              <th>Username</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.label}</td>
                <td>{a.targetUrl}</td>
                <td>{a.username}</td>
                <td>{a.role ?? "—"}</td>
                <td>
                  <button className="danger" onClick={() => onDelete(a.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {!accounts.length && (
              <tr>
                <td colSpan={5}>No accounts yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
