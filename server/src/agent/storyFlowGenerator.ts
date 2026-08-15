import { GoogleGenAI } from "@google/genai";
import { DetectedModule, TestType } from "../types.js";
import { FlowStepDef } from "./flowExecutor.js";
import { GEMINI_MODEL, callGeminiWithRetry, isGeminiDailyQuotaExhausted } from "./geminiModel.js";

let client: GoogleGenAI | null | undefined;

function getClient(): GoogleGenAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  return client;
}

export interface StoryFlow {
  title: string;
  expectation: string;
  testType: TestType;
  steps: FlowStepDef[];
}

export interface RequiredDetail {
  key: string;
  question: string;
}

export interface StoryGenerationResult {
  flows: StoryFlow[];
  requiredDetails: RequiredDetail[];
}

const VALID_ACTIONS = new Set([
  "navigate",
  "fill",
  "click",
  "expectUrlContains",
  "expectTextContains",
  "expectElementVisible",
]);

function sanitizeSteps(rawSteps: unknown): FlowStepDef[] {
  if (!Array.isArray(rawSteps)) return [];
  const steps: FlowStepDef[] = [];
  for (const raw of rawSteps) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.action !== "string" || !VALID_ACTIONS.has(s.action)) continue;
    steps.push({
      order: steps.length,
      action: s.action,
      selector: typeof s.selector === "string" ? s.selector : undefined,
      value: typeof s.value === "string" ? s.value : undefined,
    });
  }
  return steps;
}

function sanitizeFlows(raw: unknown): StoryFlow[] {
  if (!Array.isArray(raw)) return [];
  const flows: StoryFlow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.title !== "string" || typeof v.expectation !== "string") continue;
    if (v.testType !== "positive" && v.testType !== "negative") continue;
    const steps = sanitizeSteps(v.steps);
    if (!steps.length) continue;
    flows.push({ title: v.title, expectation: v.expectation, testType: v.testType, steps });
  }
  return flows;
}

function sanitizeRequiredDetails(raw: unknown): RequiredDetail[] {
  if (!Array.isArray(raw)) return [];
  const details: RequiredDetail[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.key !== "string" || typeof v.question !== "string") continue;
    details.push({ key: v.key, question: v.question });
  }
  return details;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function buildPrompt(testStories: string, modules: DetectedModule[]): string {
  const moduleSummary = modules
    .map((m) => {
      const fields = m.fields
        .map(
          (f) =>
            `    - "${f.label || f.name}": selector input[name="${f.name}"], type ${f.type}${f.required ? ", required" : ""}`,
        )
        .join("\n");
      return `- ${m.name} (${m.type}) at ${m.url}\n${fields || "    (no fields)"}`;
    })
    .join("\n");

  return `You are converting QA test scenarios written in plain English into automated browser test flows for a web application under test.

Pages/forms discovered on the application:
${moduleSummary || "(none discovered)"}

Test scenarios written by a QA tester (plain English, possibly multiple, one idea per line or paragraph):
"""
${testStories}
"""

For EACH distinct scenario described, produce one flow: a short ordered sequence of steps using ONLY these actions:
- navigate: go to a URL (value = a full URL from the list above)
- fill: type into a field (selector = a CSS selector such as input[name="username"], value = the text to type)
- click: click a button or link (selector = a CSS selector, e.g. button:has-text("Submit"))
- expectUrlContains: assert the current URL contains a substring (value = the substring)
- expectTextContains: assert visible page text contains a substring (value = the substring; selector optional to scope it)
- expectElementVisible: assert an element is visible (selector = a CSS selector)

Rules:
- Always start each flow with a "navigate" step to the relevant page's URL from the list above.
- Use realistic field values appropriate to the field's type/label/name (e.g. a valid email for an email field; an intentionally wrong value when the scenario calls for invalid input).
- End each flow with at least one "expect*" step that actually verifies the scenario's expected outcome.
- Classify each flow's "testType" as "positive" (valid input / expected normal usage) or "negative" (invalid input, or something that should be rejected/blocked/denied).
- Write a one-sentence "expectation" describing what should happen, matching the scenario's intent.
- If a scenario can't be mapped to the discovered pages/forms, do your best with the closest matching page rather than omitting it.

Required details: if a scenario references a SPECIFIC concrete piece of data you cannot invent or infer from the page (e.g. a real employee ID, an existing order number, a specific record's name) — as opposed to a generic value you can make up (e.g. a plausible email, a name, "test" text) — do NOT guess it. Instead:
1. Add an entry to "requiredDetails": { "key": "a_short_snake_case_key", "question": "a plain-English question asking the tester for that value" }.
2. In the step(s) that need it, use "{{a_short_snake_case_key}}" as the value (literally that placeholder text) instead of a guessed value.
3. If the scenario text already contains a line answering that detail (e.g. under a heading like "Additional details"), use the given concrete value directly instead of a placeholder, and do not add it to requiredDetails again.
It's fine for requiredDetails to be empty — most scenarios need no real data lookups.

Respond with ONLY a JSON object, no markdown, no code fences, no commentary, in this exact shape:
{
  "requiredDetails": [
    { "key": "employee_id", "question": "What is a valid employee ID to search for?" }
  ],
  "flows": [
    {
      "title": "short flow name",
      "expectation": "one sentence describing the expected outcome",
      "testType": "positive",
      "steps": [
        { "action": "navigate", "value": "https://example.com/login" },
        { "action": "fill", "selector": "input[name=\\"username\\"]", "value": "someone" },
        { "action": "click", "selector": "button:has-text(\\"Submit\\")" },
        { "action": "expectUrlContains", "value": "dashboard" }
      ]
    }
  ]
}`;
}

// Converts freeform QA scenarios into executable browser test flows via
// Gemini. Returns null (never throws) when GEMINI_API_KEY isn't configured
// or the call/parse fails, or "daily-quota-exhausted" specifically when
// Google's free-tier per-day request cap has been hit (a distinct, much
// more common failure worth a clearer message than a generic one) —
// callers should surface either as a visible error test case rather than
// silently dropping the tester's scenarios. Returns empty
// flows/requiredDetails (not null) when testStories is blank, since that's
// not a failure — there's just nothing to generate.
export async function generateStoryFlows(
  testStories: string,
  modules: DetectedModule[],
): Promise<StoryGenerationResult | null | "daily-quota-exhausted"> {
  if (!testStories.trim()) return { flows: [], requiredDetails: [] };

  const genAI = getClient();
  if (!genAI) return null;

  try {
    const response = await callGeminiWithRetry(() =>
      genAI.models.generateContent({
        model: GEMINI_MODEL,
        contents: buildPrompt(testStories, modules),
        config: { httpOptions: { timeout: 30_000 } },
      }),
    );
    const text = response.text ?? "";
    const raw = extractJsonObject(text);
    if (!raw) {
      console.error(
        `generateStoryFlows: no JSON object found in the Gemini response. Raw response (first 500 chars): ${text.slice(0, 500)}`,
      );
      return null;
    }
    const flows = sanitizeFlows(raw.flows);
    const requiredDetails = sanitizeRequiredDetails(raw.requiredDetails);
    if (!flows.length && !requiredDetails.length) {
      console.error(
        `generateStoryFlows: Gemini returned a JSON object but it had no valid flows or required details. Parsed: ${JSON.stringify(raw).slice(0, 500)}`,
      );
      return null;
    }
    return { flows, requiredDetails };
  } catch (err) {
    if (isGeminiDailyQuotaExhausted(err)) {
      console.error("generateStoryFlows: Gemini daily free-tier quota exhausted for today", err);
      return "daily-quota-exhausted";
    }
    console.error("generateStoryFlows: Gemini call failed", err);
    return null;
  }
}
