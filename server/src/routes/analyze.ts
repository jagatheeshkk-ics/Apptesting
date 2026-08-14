import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { crawlAndIdentifyModules, looksLikeLoginForm } from "../agent/crawler.js";
import { generateUserStories } from "../agent/userStoryGenerator.js";

// Crawl-only preview: identifies modules on a URL and generates a starting
// set of editable user stories for each, without creating a TestRun or
// running any tests. Used by the "New test run" page so stories can be
// reviewed/edited before the user commits to a run.
export async function analyzeRoutes(app: FastifyInstance) {
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
        crawl.modules.map(async (m) => ({
          name: m.name,
          url: m.url,
          type: m.type,
          fields: m.fields,
          userStories: await generateUserStories(m),
        })),
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
}
