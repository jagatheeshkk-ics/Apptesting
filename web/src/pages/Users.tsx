import { FormEvent, useEffect, useState } from "react";
import { User, api } from "../api.js";

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.listUsers().then(setUsers).catch(() => {});
  }

  useEffect(load, []);

  function resetForm() {
    setEditingId(null);
    setUsername("");
    setDisplayName("");
    setEmail("");
    setPassword("");
    setError(null);
  }

  function startEdit(user: User) {
    setEditingId(user.id);
    setUsername(user.username);
    setDisplayName(user.displayName ?? "");
    setEmail(user.email ?? "");
    setPassword("");
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editingId) {
        await api.updateUser(editingId, {
          username,
          displayName,
          email,
          password: password || undefined,
        });
      } else {
        if (!password) {
          setError("Password is required for a new user.");
          return;
        }
        await api.createUser({ username, displayName, email, password });
      }
      resetForm();
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDelete(id: string) {
    await api.deleteUser(id);
    if (editingId === id) resetForm();
    load();
  }

  return (
    <div>
      <h2>{editingId ? "Edit user" : "Add a User"}</h2>
      <div className="card">
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label>Username</label>
            <input required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Jags" />
          </div>
          <div className="form-row">
            <label>Display Name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Jane Doe" />
          </div>
          <div className="form-row">
            <label>
              Email <span style={{ fontWeight: 400, color: "#59636e" }}>(for bug notifications)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. jane@example.com"
            />
          </div>
          <div className="form-row">
            <label>Password{editingId ? " (leave blank to keep current)" : ""}</label>
            <input
              required={!editingId}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p style={{ color: "#cf222e" }}>{error}</p>}
          <button className="primary" type="submit">
            {editingId ? "Save User" : "Add User"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} style={{ marginLeft: 10, background: "none", border: "none", color: "#59636e", cursor: "pointer" }}>
              Cancel
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Display Name</th>
              <th>Email</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.displayName ?? "—"}</td>
                <td>{u.email ?? "—"}</td>
                <td>{new Date(u.createdAt).toLocaleString()}</td>
                <td style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => startEdit(u)}>Edit</button>
                  <button className="danger" onClick={() => onDelete(u.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={5}>No users yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
