import { FormEvent, useEffect, useState } from "react";
import { PAGE_LABELS, PageKey, Role, api } from "../api.js";

const ALL_PAGES = Object.keys(PAGE_LABELS) as PageKey[];

export default function Roles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPages, setSelectedPages] = useState<PageKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.listRoles().then(setRoles).catch(() => {});
  }

  useEffect(load, []);

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setSelectedPages([]);
    setError(null);
  }

  function startEdit(role: Role) {
    setEditingId(role.id);
    setName(role.name);
    setDescription(role.description ?? "");
    setSelectedPages(role.allowedPages);
    setError(null);
  }

  function togglePage(page: PageKey) {
    setSelectedPages((sel) => (sel.includes(page) ? sel.filter((p) => p !== page) : [...sel, page]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedPages.length) {
      setError("Select at least one page this role can see.");
      return;
    }
    try {
      if (editingId) {
        await api.updateRole(editingId, { name, description, allowedPages: selectedPages });
      } else {
        await api.createRole({ name, description, allowedPages: selectedPages });
      }
      resetForm();
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDelete(id: string) {
    await api.deleteRole(id);
    if (editingId === id) resetForm();
    load();
  }

  return (
    <div>
      <h2>Roles</h2>
      <p>
        A role limits which dashboard pages a user can see. Assign a role to a user on the Users page — a user with
        no role keeps full, unrestricted access.
      </p>

      <div className="card">
        <h3>{editingId ? "Edit role" : "Add a role"}</h3>
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label>Name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="QA Tester" />
          </div>
          <div className="form-row">
            <label>Description (optional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Pages this role can see</label>
            <div style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: 10 }}>
              {ALL_PAGES.map((page) => (
                <label key={page} style={{ display: "block", fontWeight: 400, padding: "2px 0" }}>
                  <input
                    type="checkbox"
                    checked={selectedPages.includes(page)}
                    onChange={() => togglePage(page)}
                    style={{ marginRight: 8 }}
                  />
                  {PAGE_LABELS[page]}
                </label>
              ))}
            </div>
          </div>
          {error && <p style={{ color: "#cf222e" }}>{error}</p>}
          <button className="primary" type="submit">
            {editingId ? "Save role" : "Add role"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              style={{ marginLeft: 10, background: "none", border: "none", color: "#59636e", cursor: "pointer" }}
            >
              Cancel
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Pages</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.description ?? "—"}</td>
                <td>{r.allowedPages.map((p) => PAGE_LABELS[p]).join(", ")}</td>
                <td style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => startEdit(r)}>Edit</button>
                  <button className="danger" onClick={() => onDelete(r.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!roles.length && (
              <tr>
                <td colSpan={4}>No roles yet — users without a role keep full access.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
