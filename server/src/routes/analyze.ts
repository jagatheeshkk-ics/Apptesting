import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { crawlAndIdentifyModules } from "../agent/crawler.js";
import { generateUserStories } from "../agent/userStoryGenerator.js";

// Crawl-only preview: identifies modules on a URL and generates a starting
// set of editable user stories for each, without creating a TestRun or
// running any tests. Used by the "New test run" page so stories can be
// reviewed/edited before the user commits to a run.
export async function analyzeRoutes(app: FastifyInstance) {
  app.post("/api/analyze", async (req, reply) => {
    const body = req.body as { targetUrl?: string; accountId?: string };
    if (!body.targetUrl) return reply.code(400).send({ error: "targetUrl is required" });

    let account = null;
    if (body.accountId) {
      account = await prisma.account.findUnique({ where: { id: body.accountId } });
    }

    let crawl;
    try {
      crawl = await crawlAndIdentifyModules({
        targetUrl: body.targetUrl,
        username: account?.username,
        password: account?.password,
        maxPages: 8,
        maxDepth: 1,
      });
    } catch (err) {
      return reply.code(502).send({ error: `could not analyze this URL: ${(err as Error).message}` });
    }

    try {
      return {
        modules: crawl.modules.map((m) => ({
          name: m.name,
          url: m.url,
          type: m.type,
          fields: m.fields,
          userStories: generateUserStories(m),
        })),
      };
    } finally {
      await crawl.context.close().catch(() => {});
      await crawl.browser.close().catch(() => {});
    }
  });
}
