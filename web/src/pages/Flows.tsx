import { FormEvent, useEffect, useState } from "react";
import { Account, FlowAction, TestFlow, api } from "../api.js";

const ACTIONS: { value: FlowAction; label: string; needsSelector: boolean; needsValue: boolean }[] = [
  { value: "navigate", label: "Navigate to URL", needsSelector: false, needsValue: true },
  { value: "fill", label: "Fill field", needsSelector: true, needsValue: true },
  { value: "click", label: "Click element", needsSelector: true, needsValue: false },
  { value: "expectUrlContains", label: "Expect URL contains", needsSelector: false, needsValue: true },
  { value: "expectTextContains", label: "Expect text contains", needsSelector: true, needsValue: true },
  { value: "expectElementVisible", label: "Expect element visible", needsSelector: true, needsValue: false },
];

interface DraftStep {
  action: FlowAction;
  selector: string;
  value: string;
}

export default function Flows() {
  const [flows, setFlows] = useState<TestFlow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [label, setLabel] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [accountId, setAccountId] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [draftAction, setDraftAction] = useState<FlowAction>("navigate");
  const [draftSelector, setDraftSelector] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.listFlows().then(setFlows).catch(() => {});
    api.listAccounts().then(setAccounts).catch(() => {});
  }

  useEffect(load, []);

  const draftMeta = ACTIONS.find((a) => a.value === draftAction)!;

  function addStep() {
    setSteps((s) => [...s, { action: draftAction, selector: draftSelector, value: draftValue }]);
    setDraftSelector("");
    setDraftValue("");
  }

  function removeStep(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!steps.length) {
      setError("Add at least one step.");
      return;
    }
    try {
      await api.createFlow({ label, targetUrl, accountId: accountId || undefined, steps });
      setLabel("");
      setTargetUrl("");
      setAccountId("");
      setSteps([]);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDelete(id: string) {
    await api.deleteFlow(id);
    load();
  }

  return (
    <div>
      <h2>Test flows</h2>
      <p>
        Define a named multi-step user journey (e.g. login → add to cart → checkout → expect confirmation). Any
        flow whose target URL matches a test run's target URL is executed automatically as part of that run —
        this covers integration, system, functional, and UAT-style testing that can't be inferred from crawling
        alone.
      </p>

      <div className="card">
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label>Flow label</label>
            <input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Checkout journey" />
          </div>
          <div className="form-row">
            <label>Target URL (must match the test run's target URL)</label>
            <input
              required
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com/"
            />
          </div>
          <div className="form-row">
            <label>Account to run as (optional)</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Any / anonymous</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Steps</label>
            {steps.length > 0 && (
              <table style={{ marginBottom: 10 }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Action</th>
                    <th>Selector</th>
                    <th>Value</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((s, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{ACTIONS.find((a) => a.value === s.action)?.label}</td>
                      <td>{s.selector || "—"}</td>
                      <td>{s.value || "—"}</td>
                      <td>
                        <button type="button" className="danger" onClick={() => removeStep(i)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Action</label>
                <select value={draftAction} onChange={(e) => setDraftAction(e.target.value as FlowAction)}>
                  {ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              {draftMeta.needsSelector && (
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Selector</label>
                  <input
                    value={draftSelector}
                    onChange={(e) => setDraftSelector(e.target.value)}
                    placeholder='e.g. input[name="email"]'
                  />
                </div>
              )}
              {draftMeta.needsValue && (
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Value</label>
                  <input
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    placeholder={draftAction === "navigate" ? "https://example.com/login" : "expected text/value"}
                  />
                </div>
              )}
              <button type="button" className="primary" onClick={addStep}>
                Add step
              </button>
            </div>
          </div>

          {error && <p style={{ color: "#cf222e" }}>{error}</p>}
          <button className="primary" type="submit">
            Save flow
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Saved flows</h3>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Target URL</th>
              <th>Account</th>
              <th>Steps</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {flows.map((f) => (
              <tr key={f.id}>
                <td>{f.label}</td>
                <td>{f.targetUrl}</td>
                <td>{f.account?.label ?? "Any"}</td>
                <td>{f.steps.length}</td>
                <td>
                  <button className="danger" onClick={() => onDelete(f.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {!flows.length && (
              <tr>
                <td colSpan={5}>No flows yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
