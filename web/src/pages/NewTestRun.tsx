import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ALL_TEST_CATEGORIES,
  AnalyzedModule,
  DetectedField,
  Project,
  RequiredDetail,
  TEST_CATEGORY_LABELS,
  TestCategory,
  api,
  moduleKey,
} from "../api.js";

interface EditableModule {
  name: string;
  url: string;
  type: string;
  fields: DetectedField[];
  stories: string[];
  storiesSource: "previous" | "none" | "ai";
}

export default function NewTestRun() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [targetUrl, setTargetUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<TestCategory>>(new Set(ALL_TEST_CATEGORIES));
  const [quickMode, setQuickMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const [modules, setModules] = useState<EditableModule[]>([]);
  const [lastAnalyzedModules, setLastAnalyzedModules] = useState<AnalyzedModule[] | null>(null);
  const [lastPreviousTestStories, setLastPreviousTestStories] = useState<string | null>(null);
  const [autoFillStories, setAutoFillStories] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);
  const [draftStory, setDraftStory] = useState<Record<number, string>>({});
  const [generatingStories, setGeneratingStories] = useState(false);
  const [generateStoriesError, setGenerateStoriesError] = useState<string | null>(null);

  const [testStories, setTestStories] = useState("");
  const [testStoriesSource, setTestStoriesSource] = useState<"previous" | "none">("none");
  const [requiredDetails, setRequiredDetails] = useState<RequiredDetail[]>([]);
  const [detailAnswers, setDetailAnswers] = useState<Record<string, string>>({});
  const [checkedStoriesText, setCheckedStoriesText] = useState<string | null>(null);
  const [checkingRequirements, setCheckingRequirements] = useState(false);
  const [requirementsError, setRequirementsError] = useState<string | null>(null);

  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [saveAsAccount, setSaveAsAccount] = useState(false);
  const [accountLabel, setAccountLabel] = useState("");

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

  function toEditableModules(found: AnalyzedModule[], fill: boolean): EditableModule[] {
    return found.map((m) => ({
      name: m.name,
      url: m.url,
      type: m.type,
      fields: m.fields,
      stories: fill ? [...m.userStories] : [],
      storiesSource: fill ? m.storiesSource : "none",
    }));
  }

  async function runAnalyze() {
    if (!isValidUrl(targetUrl) || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const { modules: found, requiresLogin, previousTestStories } = await api.analyzeUrl({
        targetUrl,
        username: loginUsername || undefined,
        password: loginPassword || undefined,
      });
      setLastAnalyzedModules(found);
      setLastPreviousTestStories(previousTestStories);
      setModules(toEditableModules(found, autoFillStories));
      setTestStories(autoFillStories && previousTestStories ? previousTestStories : "");
      setTestStoriesSource(autoFillStories && previousTestStories ? "previous" : "none");
      setCheckedStoriesText(null);
      setRequiredDetails([]);
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

  // Re-derives the module list and test stories from the last analyze
  // response instead of re-crawling — flipping this is purely a display
  // choice about whether to show what's already known, not a reason to
  // re-hit the target site.
  function onToggleAutoFillStories(checked: boolean) {
    setAutoFillStories(checked);
    if (lastAnalyzedModules) setModules(toEditableModules(lastAnalyzedModules, checked));
    setTestStories(checked && lastPreviousTestStories ? lastPreviousTestStories : "");
    setTestStoriesSource(checked && lastPreviousTestStories ? "previous" : "none");
    setCheckedStoriesText(null);
    setRequiredDetails([]);
  }

  // Only for modules with no stories yet — those pre-filled from a
  // previous run, or already hand-typed, are left alone. AI drafting only
  // ever happens here, from this explicit click.
  async function generateStories() {
    const targets = modules.filter((m) => !m.stories.length);
    if (!targets.length || generatingStories) return;
    setGeneratingStories(true);
    setGenerateStoriesError(null);
    try {
      const { userStories } = await api.generateModuleStories(
        targets.map((m) => ({ name: m.name, url: m.url, type: m.type, fields: m.fields })),
      );
      setModules((mods) =>
        mods.map((m) => {
          const stories = userStories[moduleKey(m.name, m.url)];
          return stories?.length ? { ...m, stories, storiesSource: "ai" } : m;
        }),
      );
    } catch (err) {
      setGenerateStoriesError((err as Error).message);
    } finally {
      setGeneratingStories(false);
    }
  }

  // Checks whether the current test stories text needs any concrete detail
  // filled in before it can run. Returns the required-detail list (possibly
  // empty) on success, or null if the check itself failed. Runs
  // automatically when the tester leaves the field (see onTestStoriesBlur)
  // or, as a fallback, right before submit — there's no separate button to
  // click for this.
  async function checkStoryRequirements(): Promise<RequiredDetail[] | null> {
    if (!testStories.trim()) return [];
    setCheckingRequirements(true);
    setRequirementsError(null);
    try {
      const { requiredDetails: found } = await api.storyRequirements({
        testStories,
        modules: modules.map((m) => ({ name: m.name, url: m.url, type: m.type, fields: m.fields })),
      });
      setRequiredDetails(found);
      setDetailAnswers((prev) => {
        const next: Record<string, string> = {};
        for (const d of found) next[d.key] = prev[d.key] ?? "";
        return next;
      });
      setCheckedStoriesText(testStories);
      return found;
    } catch (err) {
      setRequirementsError((err as Error).message);
      return null;
    } finally {
      setCheckingRequirements(false);
    }
  }

  function onTestStoriesBlur() {
    if (testStories.trim() && testStories !== checkedStoriesText && !checkingRequirements) {
      checkStoryRequirements();
    }
  }

  function onTestStoriesChange(value: string) {
    setTestStories(value);
    setTestStoriesSource("none");
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

  function buildAugmentedTestStories(): string {
    if (!testStories.trim() || !requiredDetails.length) return testStories;
    const lines = requiredDetails.map((d) => `- ${d.question}: ${detailAnswers[d.key]?.trim() ?? ""}`);
    return `${testStories}\n\nAdditional details provided by the tester:\n${lines.join("\n")}`;
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
    if (testStories.trim()) {
      let details = requiredDetails;
      if (checkedStoriesText !== testStories) {
        const found = await checkStoryRequirements();
        if (found === null) {
          setError("Could not check the test stories for required details — see the error above and try again.");
          setSubmitting(false);
          return;
        }
        details = found;
      }
      if (details.some((d) => !detailAnswers[d.key]?.trim())) {
        setError("Please answer all the required details below before starting the run.");
        setSubmitting(false);
        return;
      }
    }
    try {
      const moduleStories: Record<string, string[]> = {};
      for (const m of modules) moduleStories[moduleKey(m.name, m.url)] = m.stories;

      const useAdHocLogin = showLoginPrompt && loginUsername && loginPassword;

      const run = await api.createTestRun({
        targetUrl,
        projectId: projectId || undefined,
        mode: quickMode ? "quick" : "full",
        enabledCategories: Array.from(selectedCategories),
        moduleStories,
        testStories: buildAugmentedTestStories().trim() || undefined,
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
        Enter a URL and leave the field — the agent analyzes the application and identifies its modules (pages,
        forms, fields). Modules tested before auto-fill with their saved user stories; otherwise write your own
        below or click "Auto-generate user stories" to have the AI draft some. Pick which types of tests to run,
        then start.
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

          <div className="form-row">
            <label style={{ display: "block", fontWeight: 400, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={autoFillStories}
                onChange={(e) => onToggleAutoFillStories(e.target.checked)}
                style={{ marginRight: 8 }}
              />
              Auto-fill stories saved from a previous test run of the same URL
              <span style={{ marginLeft: 4, fontWeight: 400, color: "#59636e" }}>
                (both the test stories below and each module's user stories)
              </span>
            </label>
          </div>

          <div className="form-row">
            <label>
              Test stories (optional){" "}
              <span style={{ fontWeight: 400, color: "#59636e" }}>
                — describe scenarios in plain English, the agent will test each one
              </span>
              {testStoriesSource === "previous" && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "#59636e" }}>(from a previous test run)</span>
              )}
            </label>
            <textarea
              rows={5}
              placeholder={
                'e.g. "Logging in with a valid username and password should reach the dashboard."\n"Logging in with the wrong password should show an error message and stay on the login page."'
              }
              value={testStories}
              onChange={(e) => onTestStoriesChange(e.target.value)}
              onBlur={onTestStoriesBlur}
              style={{ padding: "8px 10px", border: "1px solid #d0d7de", borderRadius: 6, fontSize: 14, fontFamily: "inherit", resize: "vertical" }}
            />
            {checkingRequirements && <p style={{ color: "#59636e", fontSize: 13 }}>Checking for required details…</p>}
            {requirementsError && <p style={{ color: "#cf222e", fontSize: 13 }}>{requirementsError}</p>}
            {checkedStoriesText === testStories && !requiredDetails.length && (
              <p style={{ color: "#1a7f37", fontSize: 13 }}>No additional details needed — ready to run.</p>
            )}
            {!!requiredDetails.length && (
              <div style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: 12, marginTop: 8 }}>
                <strong style={{ fontSize: 13 }}>This needs a few details before it can run:</strong>
                {requiredDetails.map((d) => (
                  <div className="form-row" key={d.key} style={{ marginTop: 8, marginBottom: 0 }}>
                    <label style={{ fontWeight: 400 }}>{d.question}</label>
                    <input
                      value={detailAnswers[d.key] || ""}
                      onChange={(e) => setDetailAnswers((a) => ({ ...a, [d.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {analyzing && <p style={{ color: "#59636e" }}>Analyzing the application…</p>}
          {analyzeError && <p style={{ color: "#cf222e" }}>Could not analyze this URL: {analyzeError}</p>}
          {!!modules.length && (
            <p style={{ color: "#59636e", fontSize: 13 }}>
              Module(s) detected: <strong>{modules.map((m) => m.name).join(", ")}</strong>
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

          {!!modules.length && (
            <div className="form-row">
              <label>
                User stories by module{" "}
                <span style={{ fontWeight: 400, color: "#59636e" }}>
                  (write your own, or auto-generate for modules with none yet; these drive what gets tested)
                </span>
              </label>
              {generateStoriesError && <p style={{ color: "#cf222e", fontSize: 13 }}>{generateStoriesError}</p>}
              {modules.map((m, mi) => (
                <div key={m.name} style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                  <strong>
                    {m.name} <span style={{ fontWeight: 400, color: "#59636e" }}>({m.type})</span>
                  </strong>
                  {m.storiesSource === "previous" && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: "#59636e" }}>(from a previous test run)</span>
                  )}
                  {m.storiesSource === "ai" && <span style={{ marginLeft: 8, fontSize: 12, color: "#59636e" }}>(AI-generated)</span>}
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
              </button>{" "}
              <button
                type="button"
                onClick={generateStories}
                disabled={generatingStories || !modules.some((m) => !m.stories.length)}
              >
                {generatingStories ? "Generating…" : "Auto-generate user stories"}
              </button>
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
