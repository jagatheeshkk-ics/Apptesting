import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { crawlAndIdentifyModules, looksLikeLoginForm } from "../agent/crawler.js";
import { generateStoryFlows } from "../agent/storyFlowGenerator.js";
import { DetectedField, DetectedModule } from "../types.js";

// Distinct business module names previously used for this target URL, most
// recently used first — feeds the New Test Run page's suggestions for the
// mandatory Module Name field so a tester reuses "Payroll" instead of
// accidentally typing "payroll" or "Pay Roll" and fragmenting its history.
async function previousModuleNamesFor(targetUrl: string): Promise<string[]> {
  const runs = await prisma.testRun.findMany({
    where: { targetUrl, moduleName: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { moduleName: true },
    distinct: ["moduleName"],
    take: 20,
  });
  return runs.map((r) => r.moduleName!).filter(Boolean);
}

export async function analyzeRoutes(app: FastifyInstance) {
  // Crawl-only preview: identifies pages/forms/fields on a URL (to drive
  // field-based test generation and login detection) without creating a
  // TestRun or running any tests. Also returns the business module names
  // previously used for this URL, so the New Test Run page can suggest them
  // for the mandatory Module Name field.
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
      const modules = crawl.modules.map((m) => ({ name: m.name, url: m.url, type: m.type, fields: m.fields }));

      // Heuristic: a login form was found (a password field, or the first
      // step of a two-step login — see looksLikeLoginForm) and we weren't
      // given credentials to get past it — the New Test Run page uses this
      // to proactively ask for login credentials for this URL instead of
      // silently testing only whatever's reachable anonymously.
      const requiresLogin = !username && crawl.modules.some((m) => m.type === "form" && looksLikeLoginForm(m.fields));
      const previousModuleNames = await previousModuleNamesFor(body.targetUrl);

      return { modules, requiresLogin, previousModuleNames };
    } finally {
      await crawl.context.close().catch(() => {});
      await crawl.browser.close().catch(() => {});
    }
  });

  // Once the tester has named the business module they're testing, look up
  // the test stories saved from the most recent prior run of that exact
  // (targetUrl, moduleName) pair, so the New Test Run page can auto-populate
  // them. A cheap DB lookup, no AI call — and unlike the old per-crawled-page
  // matching, this is an exact tester-chosen name match, not a heuristic.
  app.post("/api/analyze/module-history", async (req, reply) => {
    const body = req.body as { targetUrl?: string; moduleName?: string };
    if (!body.targetUrl || !body.moduleName?.trim()) {
      return reply.code(400).send({ error: "targetUrl and moduleName are required" });
    }

    const previous = await prisma.testRun.findFirst({
      where: { targetUrl: body.targetUrl, moduleName: body.moduleName.trim(), testStories: { not: null } },
      orderBy: { startedAt: "desc" },
    });
    return { previousTestStories: previous?.testStories ?? null };
  });

  // Preview-only: for the freeform "Test stories" textarea, asks the AI
  // whether executing the described scenarios needs any concrete detail
  // (e.g. a real record ID) it can't infer, without generating/persisting
  // the actual flow yet. Runs automatically when the tester leaves the
  // field — never while they're still typing.
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
    if (result === "overloaded") {
      return reply.code(502).send({
        error:
          "Could not analyze the test stories — Google's AI service is briefly overloaded with demand. This usually clears within a minute or two; leave the field and try again shortly.",
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
