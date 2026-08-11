import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ALL_TEST_CATEGORIES, Account, AnalyzedModule, Project, TEST_CATEGORY_LABELS, TestCategory, api } from "../api.js";

interface EditableModule {
  name: string;
  url: string;
  type: string;
  stories: string[];
}

export default function NewTestRun() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [targetUrl, setTargetUrl] = useState("");
  const [accountId, setAccountId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<TestCategory>>(new Set(ALL_TEST_CATEGORIES));
  const [quickMode, setQuickMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const [modules, setModules] = useState<EditableModule[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);
  const [draftStory, setDraftStory] = useState<Record<number, string>>({});

  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => {});
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

  function onAccountChange(id: string) {
    setAccountId(id);
    if (!projectId) {
      const account = accounts.find((a) => a.id === id);
      if (account?.projectId) setProjectId(account.projectId);
    }
  }

  function isValidUrl(value: string) {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  async function runAnalyze() {
    if (!isValidUrl(targetUrl) || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const { modules: found } = await api.analyzeUrl({ targetUrl, accountId: accountId || undefined });
      setModules(
        found.map((m: AnalyzedModule) => ({ name: m.name, url: m.url, type: m.type, stories: [...m.userStories] })),
      );
      setAnalyzedUrl(targetUrl);
    } catch (err) {
      setAnalyzeError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  function onUrlBlur() {
    if (targetUrl && targetUrl !== analyzedUrl) runAnalyze();
  }

  function updateStory(moduleIdx: number, storyIdx: number, value: string) {
    setModules((mods) =>
      mods.map((m, i) => (i === moduleIdx ? { ...m, stories: m.stories.map((s, j) => (j === storyIdx ? value : s)) } : m)),
    );
  }

  function removeStory(moduleIdx: number, storyIdx: number) {
    setModules((mods) =>
      mods.map((m, i) => (i === moduleIdx ? { ...m, stories: m.stories.filter((_, j) => j !== storyIdx) } : m)),
    );
  }

  function addStory(moduleIdx: number) {
    const text = (draftStory[moduleIdx] || "").trim();
    if (!text) return;
    setModules((mods) => mods.map((m, i) => (i === moduleIdx ? { ...m, stories: [...m.stories, text] } : m)));
    setDraftStory((d) => ({ ...d, [moduleIdx]: "" }));
  }

  function toggleCategory(cat: TestCategory) {
    setSelectedCategories((sel) => {
      const next = new Set(sel);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function toggleAllCategories() {
    setSelectedCategories((sel) => (sel.size === ALL_TEST_CATEGORIES.length ? new Set() : new Set(ALL_TEST_CATEGORIES)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    if (!selectedCategories.size) {
      setError("Select at least one type of test to run.");
      setSubmitting(false);
      return;
    }
    try {
      const moduleStories: Record<string, string[]> = {};
      for (const m of modules) moduleStories[m.name] = m.stories;

      const run = await api.createTestRun({
        targetUrl,
        accountId: accountId || undefined,
        projectId: projectId || undefined,
        mode: quickMode ? "quick" : "full",
        enabledCategories: Array.from(selectedCategories),
        moduleStories,
      });
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
        Enter a URL and leave the field — the agent analyzes the application, identifies its modules (pages, forms,
        fields), and drafts a starting set of user stories for each one, which you can edit or add to below. Pick
        which types of tests to run, then start.
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
              onBlur={onUrlBlur}
            />
          </div>

          {analyzing && <p style={{ color: "#59636e" }}>Analyzing the application…</p>}
          {analyzeError && <p style={{ color: "#cf222e" }}>Could not analyze this URL: {analyzeError}</p>}

          {!!modules.length && (
            <div className="form-row">
              <label>
                User stories by module{" "}
                <span style={{ fontWeight: 400, color: "#59636e" }}>
                  (auto-drafted — edit, remove, or add your own; these drive what gets tested)
                </span>
              </label>
              {modules.map((m, mi) => (
                <div key={m.name} style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                  <strong>
                    {m.name} <span style={{ fontWeight: 400, color: "#59636e" }}>({m.type})</span>
                  </strong>
                  <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
                    {m.stories.map((s, si) => (
                      <li key={si} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <input value={s} onChange={(e) => updateStory(mi, si, e.target.value)} style={{ flex: 1 }} />
                        <button type="button" className="danger" onClick={() => removeStory(mi, si)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      placeholder="Add a user story…"
                      value={draftStory[mi] || ""}
                      onChange={(e) => setDraftStory((d) => ({ ...d, [mi]: e.target.value }))}
                      style={{ flex: 1 }}
                    />
                    <button type="button" onClick={() => addStory(mi)}>
                      Add
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={runAnalyze} disabled={analyzing}>
                Re-analyze URL
              </button>
            </div>
          )}

          <div className="form-row">
            <label>Login account (optional)</label>
            <select value={accountId} onChange={(e) => onAccountChange(e.target.value)}>
              <option value="">None — test anonymously</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.role ?? "no role"})
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Project (optional — used to consolidate test case counts)</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None / Unassigned</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Types of test to run</label>
            <div style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: 10 }}>
              <label style={{ display: "block", fontWeight: 600, padding: "2px 0", borderBottom: "1px solid #eaeef2", marginBottom: 6 }}>
                <input
                  type="checkbox"
                  checked={selectedCategories.size === ALL_TEST_CATEGORIES.length}
                  onChange={toggleAllCategories}
                  style={{ marginRight: 8 }}
                />
                All types
              </label>
              {ALL_TEST_CATEGORIES.map((cat) => (
                <label key={cat} style={{ display: "block", fontWeight: 400, padding: "2px 0" }}>
                  <input
                    type="checkbox"
                    checked={selectedCategories.has(cat)}
                    onChange={() => toggleCategory(cat)}
                    style={{ marginRight: 8 }}
                  />
                  {TEST_CATEGORY_LABELS[cat]}
                </label>
              ))}
            </div>
          </div>
          <div className="form-row">
            <label style={{ fontWeight: 400 }}>
              <input type="checkbox" checked={quickMode} onChange={(e) => setQuickMode(e.target.checked)} style={{ marginRight: 8 }} />
              Quick/sanity mode — only re-run cases that failed last time (plus smoke, from the selected types above)
            </label>
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
