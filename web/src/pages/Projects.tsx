import { FormEvent, useEffect, useState } from "react";
import { Project, ProjectKpi, ProjectKpiSummary, api } from "../api.js";

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [summary, setSummary] = useState<ProjectKpiSummary | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [moduleName, setModuleName] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");

  function load() {
    api.listProjects().then(setProjects).catch(() => {});
    api.projectKpis().then(setSummary).catch(() => {});
  }

  useEffect(load, []);

  async function onCreateProject(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createProject({ name, description: description || undefined });
      setName("");
      setDescription("");
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDeleteProject(id: string) {
    await api.deleteProject(id);
    if (expanded === id) setExpanded(null);
    load();
  }

  async function onAddModule(e: FormEvent, projectId: string) {
    e.preventDefault();
    setError(null);
    try {
      await api.addProjectModule(projectId, { name: moduleName, description: moduleDescription || undefined });
      setModuleName("");
      setModuleDescription("");
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDeleteModule(projectId: string, moduleId: string) {
    await api.deleteProjectModule(projectId, moduleId);
    load();
  }

  function kpiFor(projectId: string): ProjectKpi | undefined {
    return summary?.projects.find((p) => p.projectId === projectId);
  }

  return (
    <div>
      <h2>Projects</h2>
      <p>
        A project is the master record for an application under test. Define its modules here, then link accounts
        and test runs to the project — test cases across all its runs get consolidated below.
      </p>

      {summary && (
        <div className="card">
          <h3>Consolidated test case counts (all projects)</h3>
          <div className="kpi-grid">
            <div className="kpi-tile">
              <div className="n">{summary.grandTotalCases}</div>
              <div className="l">Total test cases</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{summary.grandPassedCases}</div>
              <div className="l">Passed</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{summary.grandFailedCases}</div>
              <div className="l">Failed</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{summary.grandErrorCases}</div>
              <div className="l">Errored</div>
            </div>
            <div className="kpi-tile">
              <div className="n">{summary.grandTotalRuns}</div>
              <div className="l">Total test runs</div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Add a project</h3>
        <form onSubmit={onCreateProject}>
          <div className="form-row">
            <label>Name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer Portal" />
          </div>
          <div className="form-row">
            <label>Description (optional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error && <p style={{ color: "#cf222e" }}>{error}</p>}
          <button className="primary" type="submit">
            Add project
          </button>
        </form>
      </div>

      {projects.map((p) => {
        const kpi = kpiFor(p.id);
        const isExpanded = expanded === p.id;
        return (
          <div className="card" key={p.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0 }}>{p.name}</h3>
                {p.description && <p style={{ margin: "4px 0", color: "#59636e" }}>{p.description}</p>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setExpanded(isExpanded ? null : p.id)}>
                  {isExpanded ? "Collapse" : "Manage modules"}
                </button>
                <button className="danger" onClick={() => onDeleteProject(p.id)}>
                  Delete
                </button>
              </div>
            </div>

            <div className="kpi-grid">
              <div className="kpi-tile">
                <div className="n">{kpi?.totalCases ?? 0}</div>
                <div className="l">Test cases</div>
              </div>
              <div className="kpi-tile">
                <div className="n">{kpi ? `${Math.round(kpi.passRate * 100)}%` : "—"}</div>
                <div className="l">Pass rate</div>
              </div>
              <div className="kpi-tile">
                <div className="n">{kpi?.vulnerabilitiesFound ?? 0}</div>
                <div className="l">Vulnerabilities</div>
              </div>
              <div className="kpi-tile">
                <div className="n">{kpi?.totalRuns ?? 0}</div>
                <div className="l">Test runs</div>
              </div>
              <div className="kpi-tile">
                <div className="n">{p.modules.length}</div>
                <div className="l">Defined modules</div>
              </div>
            </div>

            {!!kpi?.moduleBreakdown.length && (
              <table>
                <thead>
                  <tr>
                    <th>Module (from test runs)</th>
                    <th>Total</th>
                    <th>Passed</th>
                    <th>Failed</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {kpi.moduleBreakdown.map((m) => (
                    <tr key={m.moduleName}>
                      <td>{m.moduleName}</td>
                      <td>{m.totalCases}</td>
                      <td>{m.passedCases}</td>
                      <td>{m.failedCases}</td>
                      <td>{m.errorCases}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {isExpanded && (
              <div>
                <h4>Modules</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Description</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.modules.map((m) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td>{m.description ?? "—"}</td>
                        <td>
                          <button className="danger" onClick={() => onDeleteModule(p.id, m.id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!p.modules.length && (
                      <tr>
                        <td colSpan={3}>No modules defined yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <form onSubmit={(e) => onAddModule(e, p.id)} style={{ marginTop: 10 }}>
                  <div className="form-row">
                    <label>Module name</label>
                    <input
                      required
                      value={moduleName}
                      onChange={(e) => setModuleName(e.target.value)}
                      placeholder="Checkout"
                    />
                  </div>
                  <div className="form-row">
                    <label>Description (optional)</label>
                    <input value={moduleDescription} onChange={(e) => setModuleDescription(e.target.value)} />
                  </div>
                  <button className="primary" type="submit">
                    Add module
                  </button>
                </form>
              </div>
            )}
          </div>
        );
      })}
      {!projects.length && <p>No projects yet — add one above.</p>}
    </div>
  );
}
