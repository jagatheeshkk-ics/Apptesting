import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { crawlAndIdentifyModules, looksLikeLoginForm } from "../agent/crawler.js";
import { generateUserStories } from "../agent/userStoryGenerator.js";
import { generateStoryFlows } from "../agent/storyFlowGenerator.js";
import { DetectedField, DetectedModule, moduleKey } from "../types.js";

// Matches on name AND url, not name alone — some apps give several
// distinct pages the same generic <title> (e.g. every page titled after
// the site itself), and matching by name only would incorrectly pull one
// page's stories onto an unrelated page that just happens to share that
// title.
async function previousStoriesFor(targetUrl: string, moduleName: string, moduleUrl: string): Promise<string[]> {
  const previous = await prisma.module.findFirst({
    where: { name: moduleName, url: moduleUrl, testRun: { targetUrl } },
    orderBy: { testRun: { startedAt: "desc" } },
  });
  return previous?.userStoriesJson ? (JSON.parse(previous.userStoriesJson) as string[]) : [];
}

export async function analyzeRoutes(app: FastifyInstance) {
  // Crawl-only preview: identifies modules on a URL, without creating a
  // TestRun or running any tests. Auto-populates each module's user
  // stories from the most recent prior test run against the same URL (a
  // cheap DB lookup, no AI call) — otherwise stories are left empty for
  // the tester to either write themselves or fill in with the
  // "Auto-generate user stories" button (POST /api/analyze/generate-stories),
  // which is a separate, explicit action so a URL analyze never silently
  // fires a burst of AI calls on its own.
  app.post("/api/analyze", async (req, reply) => {
    const body = req.body as { targetUrl?: string; accountId?: string; username?: string; password?: string };
    if (!body.targetUrl) return reply.code(400).send({ error: "targetUrl is required" });

    let username = body.username;
    let password = body.password;
    if (body.accountId) {
      const account = await prisma.account.findUnique({ where: { id: body.accountId } });
      username = account?.username;
      password = account?.password;
    }

    let crawl;
    try {
      crawl = await crawlAndIdentifyModules({
        targetUrl: body.targetUrl,
        username,
        password,
        maxPages: 8,
        maxDepth: 1,
      });
    } catch (err) {
      return reply.code(502).send({ error: `could not analyze this URL: ${(err as Error).message}` });
    }

    try {
      const modules = await Promise.all(
        crawl.modules.map(async (m) => {
          const userStories = await previousStoriesFor(body.targetUrl!, m.name, m.url);
          return {
            name: m.name,
            url: m.url,
            type: m.type,
            fields: m.fields,
            userStories,
            storiesSource: userStories.length ? ("previous" as const) : ("none" as const),
          };
        }),
      );

      // Heuristic: a login form was found (a password field, or the first
      // step of a two-step login — see looksLikeLoginForm) and we weren't
      // given credentials to get past it — the New Test Run page uses this
      // to proactively ask for login credentials for this URL instead of
      // silently testing only whatever's reachable anonymously.
      const requiresLogin = !username && crawl.modules.some((m) => m.type === "form" && looksLikeLoginForm(m.fields));

      return { modules, requiresLogin };
    } finally {
      await crawl.context.close().catch(() => {});
      await crawl.browser.close().catch(() => {});
    }
  });

  // Explicit, button-triggered AI story drafting for a set of already-
  // crawled modules (no re-crawl). Kept separate from POST /api/analyze
  // so entering a URL never triggers AI calls on its own — only clicking
  // "Auto-generate user stories" does.
  app.post("/api/analyze/generate-stories", async (req, reply) => {
    const body = req.body as {
      modules?: { name: string; url: string; type: string; fields: DetectedField[] }[];
    };
    if (!body.modules?.length) return reply.code(400).send({ error: "modules is required" });

    const userStories: Record<string, string[]> = {};
    // Sequential, not Promise.all: each module triggers a Gemini call, and
    // Google's free tier allows only a handful of requests per minute —
    // firing them all at once guarantees most get rate-limited.
    for (const m of body.modules) {
      // Keyed by name+url, not name alone — some apps give several
      // distinct pages the same generic <title>, and keying by name only
      // would let one module's stories silently overwrite another's.
      userStories[moduleKey(m.name, m.url)] = await generateUserStories(m as DetectedModule);
    }
    return { userStories };
  });

  // Preview-only: for the freeform "Test stories" textarea, asks the AI
  // whether executing the described scenarios needs any concrete detail
  // (e.g. a real record ID) it can't infer, without generating/persisting
  // the actual flow yet. Button-triggered from the New Test Run page —
  // never fired automatically while the tester is still typing.
  app.post("/api/analyze/story-requirements", async (req, reply) => {
    const body = req.body as {
      testStories?: string;
      modules?: { name: string; url: string; type: string; fields: DetectedField[] }[];
    };
    if (!body.testStories?.trim()) return { requiredDetails: [] };

    const result = await generateStoryFlows(body.testStories, (body.modules ?? []) as DetectedModule[]);
    if (result === "daily-quota-exhausted") {
      return reply.code(502).send({
        error:
          "Could not analyze the test stories — Gemini's free-tier daily request quota is exhausted for today. It resets after 24 hours, or you can enable billing on your Google AI Studio project to remove the daily cap.",
      });
    }
    if (!result) {
      return reply.code(502).send({
        error: "Could not analyze the test stories — the AI call failed or isn't configured. Check server logs.",
      });
    }
    return { requiredDetails: result.requiredDetails };
  });
}
