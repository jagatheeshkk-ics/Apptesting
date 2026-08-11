import { FormEvent, useEffect, useState } from "react";
import { Role, User, api } from "../api.js";

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.listUsers().then(setUsers).catch(() => {});
    api.listRoles().then(setRoles).catch(() => {});
  }

  useEffect(load, []);

  function resetForm() {
    setEditingId(null);
    setUsername("");
    setDisplayName("");
    setEmail("");
    setPassword("");
    setRoleId("");
    setError(null);
  }

  function startEdit(user: User) {
    setEditingId(user.id);
    setUsername(user.username);
    setDisplayName(user.displayName ?? "");
    setEmail(user.email);
    setPassword("");
    setRoleId(user.roleId ?? "");
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
          roleId: roleId || null,
        });
      } else {
        if (!password) {
          setError("Password is required for a new user.");
          return;
        }
        await api.createUser({ username, displayName, email, password, roleId: roleId || undefined });
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
              Email <span style={{ fontWeight: 400, color: "#59636e" }}>(used to log in — must be verified on first login)</span>
            </label>
            <input
              required
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
          <div className="form-row">
            <label>
              Role <span style={{ fontWeight: 400, color: "#59636e" }}>(controls which pages they can see — no role means full access)</span>
            </label>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">No role — full access</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
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
              <th>Email verified</th>
              <th>Role</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.displayName ?? "—"}</td>
                <td>{u.email}</td>
                <td>
                  <span className={`badge ${u.emailVerifiedAt ? "pass" : "pending"}`}>
                    {u.emailVerifiedAt ? "Verified" : "Not yet"}
                  </span>
                </td>
                <td>{u.role?.name ?? "Full access"}</td>
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
                <td colSpan={7}>No users yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
