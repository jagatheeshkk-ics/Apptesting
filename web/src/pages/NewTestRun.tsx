import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ALL_TEST_CATEGORIES,
  AnalyzedModule,
  Project,
  TEST_CATEGORY_LABELS,
  TestCategory,
  api,
} from "../api.js";

export default function NewTestRun() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [targetUrl, setTargetUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<TestCategory>>(new Set(ALL_TEST_CATEGORIES));
  const [quickMode, setQuickMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const [crawledModules, setCrawledModules] = useState<AnalyzedModule[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);

  const [moduleName, setModuleName] = useState("");
  const [moduleNameSuggestions, setModuleNameSuggestions] = useState<string[]>([]);
  const [checkingModuleHistory, setCheckingModuleHistory] = useState(false);

  const [testStories, setTestStories] = useState("");
  const [testStoriesSource, setTestStoriesSource] = useState<"previous" | "none">("none");

  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [saveAsAccount, setSaveAsAccount] = useState(false);
  const [accountLabel, setAccountLabel] = useState("");
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

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
    const isNewTarget = targetUrl !== analyzedUrl;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const { modules: found, requiresLogin, previousModuleNames, loggedIn: loginResult } = await api.analyzeUrl({
        targetUrl,
        username: loginUsername || undefined,
        password: loginPassword || undefined,
      });
      setCrawledModules(found);
      setModuleNameSuggestions(previousModuleNames);
      setLoggedIn(loginResult);
      // A fresh target URL means whatever module name/stories were entered
      // belonged to the previous URL — don't carry them over. A re-analyze
      // of the SAME URL (e.g. after submitting login credentials) leaves
      // them alone.
      if (isNewTarget) {
        setModuleName("");
        setTestStories("");
        setTestStoriesSource("none");
      }
      setAnalyzedUrl(targetUrl);
      if (requiresLogin) setShowLoginPrompt(true);
    } catch (err) {
      setAnalyzeError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  function onUrlBlur() {
    if (targetUrl && targetUrl !== analyzedUrl) runAnalyze();
  }

  // Once the tester names the module, look up test stories saved from the
  // most recent prior run of this exact (targetUrl, moduleName) — an exact
  // match on a name the tester chose, so it's safe to auto-populate without
  // an opt-in toggle. Only fills in if the tester hasn't already started
  // typing something else in the meantime.
  async function onModuleNameBlur() {
    const name = moduleName.trim();
    if (!name || !analyzedUrl || checkingModuleHistory) return;
    setCheckingModuleHistory(true);
    try {
      const { previousTestStories } = await api.moduleHistory({ targetUrl: analyzedUrl, moduleName: name });
      if (previousTestStories && !testStories.trim()) {
        setTestStories(previousTestStories);
        setTestStoriesSource("previous");
      }
    } catch {
      // Non-critical — the tester can still type their own stories.
    } finally {
      setCheckingModuleHistory(false);
    }
  }

  function onTestStoriesChange(value: string) {
    setTestStories(value);
    setTestStoriesSource("none");
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
    if (!moduleName.trim()) {
      setError("Enter a name for the module you're testing.");
      setSubmitting(false);
      return;
    }
    if (!testStories.trim()) {
      setError("Describe what needs to be tested in this URL under Test stories.");
      setSubmitting(false);
      return;
    }
    if (!selectedCategories.size) {
      setError("Select at least one type of test to run.");
      setSubmitting(false);
      return;
    }
    try {
      const useAdHocLogin = showLoginPrompt && loginUsername && loginPassword;

      const run = await api.createTestRun({
        targetUrl,
        moduleName: moduleName.trim(),
        projectId: projectId || undefined,
        mode: quickMode ? "quick" : "full",
        enabledCategories: Array.from(selectedCategories),
        testStories: testStories.trim(),
        username: useAdHocLogin ? loginUsername : undefined,
        password: useAdHocLogin ? loginPassword : undefined,
        saveAsAccount: useAdHocLogin ? saveAsAccount : undefined,
        accountLabel: useAdHocLogin && saveAsAccount ? accountLabel : undefined,
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
        Enter a URL and leave the field, then name the module you're testing (e.g. "Payroll") and describe what
        needs to be tested. Pick which types of tests to run, then start.
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

          {analyzedUrl === targetUrl && (
            <div className="form-row">
              <label>
                Module name{" "}
                <span style={{ fontWeight: 400, color: "#59636e" }}>
                  — what business module is this URL part of? (e.g. Payroll, CPF, Attendance)
                </span>
              </label>
              <input
                required
                list="module-name-suggestions"
                placeholder="e.g. Payroll"
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
                onBlur={onModuleNameBlur}
              />
              <datalist id="module-name-suggestions">
                {moduleNameSuggestions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
          )}

          <div className="form-row">
            <label>
              Test stories{" "}
              <span style={{ fontWeight: 400, color: "#59636e" }}>
                — describe everything that needs to be tested in this URL/module, the agent will test each scenario
              </span>
              {testStoriesSource === "previous" && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "#59636e" }}>(from a previous test run of this module)</span>
              )}
            </label>
            <textarea
              rows={6}
              required
              placeholder={
                'e.g. "Logging in with a valid username and password should reach the dashboard."\n"Logging in with the wrong password should show an error message and stay on the login page."'
              }
              value={testStories}
              onChange={(e) => onTestStoriesChange(e.target.value)}
              style={{ padding: "8px 10px", border: "1px solid #d0d7de", borderRadius: 6, fontSize: 14, fontFamily: "inherit", resize: "vertical" }}
            />
          </div>

          {!!crawledModules.length && (
            <p style={{ color: "#59636e", fontSize: 13 }}>
              Page(s)/form(s) detected on this URL: <strong>{crawledModules.map((m) => m.name).join(", ")}</strong>
            </p>
          )}

          {showLoginPrompt && (
            <div className="form-row" style={{ border: "1px solid #d4a72c", background: "#fff8e6", borderRadius: 8, padding: 12 }}>
              <label>This URL requires a login to test beyond the login page</label>
              <p style={{ margin: "0 0 8px", color: "#59636e", fontSize: 13 }}>
                Enter the credentials for <strong>{targetUrl}</strong> so the agent can log in and test the full
                application, not just the login page.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  placeholder="Username or email"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  style={{ flex: 1, minWidth: 180 }}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  style={{ flex: 1, minWidth: 180 }}
                />
                <button type="button" onClick={runAnalyze} disabled={analyzing || !loginUsername || !loginPassword}>
                  Re-analyze with these credentials
                </button>
              </div>
              {loggedIn === true && (
                <p style={{ color: "#1a7f37", fontSize: 13, marginTop: 8 }}>
                  ✓ Logged in successfully — the pages/forms above reflect the authenticated view.
                </p>
              )}
              {loggedIn === false && (
                <p style={{ color: "#cf222e", fontSize: 13, marginTop: 8 }}>
                  ⚠ Could not confirm this login succeeded — the crawl continued anonymously, so testing may only
                  cover the login page. Double-check the username/password, or this login form may use a layout the
                  agent doesn't recognize yet.
                </p>
              )}
              <label style={{ display: "block", fontWeight: 400, marginTop: 10 }}>
                <input type="checkbox" checked={saveAsAccount} onChange={(e) => setSaveAsAccount(e.target.checked)} style={{ marginRight: 8 }} />
                Save these as a reusable login account
              </label>
              {saveAsAccount && (
                <input
                  placeholder="Account label (e.g. Standard user)"
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                  style={{ marginTop: 6, width: "100%" }}
                />
              )}
            </div>
          )}

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
