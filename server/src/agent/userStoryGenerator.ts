import { DetectedModule } from "../types.js";
import { generateAIUserStories } from "./aiUserStoryGenerator.js";

// Heuristic, template-based generation from the crawled module's shape (type,
// field names/types) — no LLM involved. Used directly when ANTHROPIC_API_KEY
// isn't configured, and as a fallback if the AI call fails for any reason.
function inferFormPurpose(module: DetectedModule): string {
  const fieldTypes = new Set(module.fields.map((f) => f.type));
  const haystack = module.fields.map((f) => `${f.name} ${f.label ?? ""}`.toLowerCase()).join(" ");
  const has = (kw: string) => haystack.includes(kw);

  if (fieldTypes.has("password") && (has("confirm") || has("repeat"))) return "create a new account";
  if (fieldTypes.has("password") && (has("register") || has("signup") || has("sign up"))) return "register for an account";
  if (fieldTypes.has("password")) return "log in to my account";
  if (has("search")) return "search for what I'm looking for";
  if (has("card") || has("payment") || has("cvv") || has("expiry")) return "complete my payment";
  if (has("address") || has("shipping") || has("zip") || has("postal")) return "provide my shipping details";
  if (has("comment") || has("message") || has("feedback")) return "send feedback";
  if (has("email") && module.fields.length <= 2) return "sign up for updates";
  return "submit my information";
}

export function generateHeuristicUserStories(module: DetectedModule): string[] {
  const stories: string[] = [];

  if (module.type === "form") {
    const purpose = inferFormPurpose(module);
    stories.push(`As a user, I want to fill out and submit the "${module.name}" so that I can ${purpose}.`);

    const required = module.fields.filter((f) => f.required);
    if (required.length) {
      const list = required.map((f) => f.label || f.name).join(", ");
      stories.push(`As a user, I expect the "${module.name}" to require ${list} before it lets me submit.`);
    }

    const withLimits = module.fields.filter((f) => f.maxLength != null || f.min != null || f.max != null);
    if (withLimits.length) {
      stories.push(
        `As a user, I expect the "${module.name}" to reject values outside the allowed length/range for its fields.`,
      );
    }
  } else if (module.type === "nav") {
    stories.push(`As a user, I want to use the "${module.name}" navigation so that I can move around the application.`);
  } else {
    stories.push(`As a user, I want to view the "${module.name}" page so that I can see its content.`);
  }

  return stories;
}

// Tries the AI generator first (if ANTHROPIC_API_KEY is configured); falls
// back to the heuristic templates on any failure or when it's not
// configured, so this never blocks a run.
export async function generateUserStories(module: DetectedModule): Promise<string[]> {
  const aiStories = await generateAIUserStories(module);
  return aiStories ?? generateHeuristicUserStories(module);
}
