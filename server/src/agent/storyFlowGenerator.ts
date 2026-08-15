import { GoogleGenAI } from "@google/genai";
import { DetectedModule, TestType } from "../types.js";
import { FlowStepDef } from "./flowExecutor.js";
import { GEMINI_MODEL, callGeminiWithRetry } from "./geminiModel.js";

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

function extractJsonArray(text: string): unknown[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
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

Respond with ONLY a JSON array, no markdown, no code fences, no commentary, in this exact shape:
[
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
]`;
}

// Converts freeform QA scenarios into executable browser test flows via
// Gemini. Returns null (never throws) when GEMINI_API_KEY isn't configured
// or the call/parse fails — callers should surface that as a visible error
// test case rather than silently dropping the tester's scenarios. Returns
// an empty array (not null) when testStories is blank, since that's not a
// failure — there's just nothing to generate.
export async function generateStoryFlows(testStories: string, modules: DetectedModule[]): Promise<StoryFlow[] | null> {
  if (!testStories.trim()) return [];

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
    const raw = extractJsonArray(text);
    if (!raw) {
      console.error(
        `generateStoryFlows: no JSON array found in the Gemini response. Raw response (first 500 chars): ${text.slice(0, 500)}`,
      );
      return null;
    }
    const flows = sanitizeFlows(raw);
    if (!flows.length) {
      console.error(
        `generateStoryFlows: Gemini returned a JSON array but none of its entries were valid flows. Parsed: ${JSON.stringify(raw).slice(0, 500)}`,
      );
      return null;
    }
    return flows;
  } catch (err) {
    console.error("generateStoryFlows: Gemini call failed", err);
    return null;
  }
}
