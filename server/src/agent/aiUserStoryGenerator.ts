import Anthropic from "@anthropic-ai/sdk";
import { DetectedModule } from "../types.js";

let client: Anthropic | null | undefined;

function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  client = apiKey ? new Anthropic({ apiKey, timeout: 15_000, maxRetries: 1 }) : null;
  return client;
}

function extractJsonArray(text: string): string[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) return parsed;
  } catch {
    // fall through
  }
  return null;
}

// Returns null (never throws) when there's no API key configured, or the
// call/parse fails for any reason — callers fall back to the heuristic
// generator so a flaky/unconfigured AI never blocks a run.
export async function generateAIUserStories(module: DetectedModule): Promise<string[] | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const fieldSummary = module.fields
    .map((f) => `- ${f.label || f.name} (${f.type}${f.required ? ", required" : ""})`)
    .join("\n");

  const prompt = `You are helping draft QA user stories for a web application module discovered by a crawler.

Module name: ${module.name}
Module type: ${module.type} (page | form | nav)
URL: ${module.url}
Fields:
${fieldSummary || "(none)"}

Write 2-4 concise user stories in "As a user, I want to ... so that ..." format, covering the module's likely purpose and any validation behavior implied by its required/typed fields. Respond with ONLY a JSON array of strings — no markdown, no explanation, no code fences.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return extractJsonArray(text);
  } catch {
    return null;
  }
}
