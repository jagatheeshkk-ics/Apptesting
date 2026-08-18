import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { accountRoutes } from "./routes/accounts.js";
import { testRunRoutes } from "./routes/testRuns.js";
import { kpiRoutes } from "./routes/kpi.js";
import { flowRoutes } from "./routes/flows.js";
import { userRoutes } from "./routes/users.js";
import { projectRoutes } from "./routes/projects.js";
import { reportRoutes } from "./routes/reports.js";
import { authRoutes } from "./routes/auth.js";
import { roleRoutes } from "./routes/roles.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { registerAuthGate } from "./auth/gate.js";
import { REPORT_DIR, SCREENSHOT_DIR } from "./agent/runner.js";
import { prisma } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

// Every test run in progress is tracked only in this process's memory (the
// browser/context, the cancellation flag, etc.) — a restart (a deploy, a
// crash, Render recycling the dyno) kills all of that without a chance to
// write a final status, leaving the DB row stuck showing "executing" (or,
// worse, "cancelling" forever if a stop was requested right before the
// restart, since nothing is left running to notice the request). Reconcile
// on boot: nothing still "cancelling" can ever finish cancelling itself, so
// call it done; nothing still pending/crawling/generating/executing can
// possibly still be running, so call it failed with a clear reason instead
// of leaving it looking perpetually in-progress.
async function reconcileOrphanedRuns(): Promise<void> {
  try {
    const cancelled = await prisma.testRun.updateMany({
      where: { status: "cancelling" },
      data: { status: "cancelled", completedAt: new Date() },
    });
    const failed = await prisma.testRun.updateMany({
      where: { status: { in: ["pending", "crawling", "generating", "executing"] } },
      data: {
        status: "failed",
        error: "This run was interrupted by a server restart (e.g. a deploy) and could not continue.",
        completedAt: new Date(),
      },
    });
    if (cancelled.count || failed.count) {
      app.log.warn(
        `Reconciled ${cancelled.count} orphaned "cancelling" run(s) to "cancelled" and ${failed.count} orphaned in-progress run(s) to "failed" on startup.`,
      );
    }
  } catch (err) {
    app.log.warn(err, "failed to reconcile orphaned test runs on startup");
  }
}
await reconcileOrphanedRuns();

if (process.env.AUTH_ENABLED === "true" && !process.env.AUTH_SECRET) {
  app.log.error("AUTH_ENABLED=true but AUTH_SECRET is not set — refusing to start. Set AUTH_SECRET to a long random string.");
  process.exit(1);
}

await app.register(cors, { origin: true, credentials: true });
await app.register(fastifyCookie);
registerAuthGate(app);

let staticRegistered = false;
try {
  await app.register(fastifyStatic, { root: SCREENSHOT_DIR, prefix: "/screenshots/", decorateReply: !staticRegistered });
  staticRegistered = true;
  await app.register(fastifyStatic, { root: REPORT_DIR, prefix: "/reports/", decorateReply: false });
} catch (err) {
  app.log.warn(err, "static asset serving not fully configured");
}

await app.register(accountRoutes);
await app.register(testRunRoutes);
await app.register(kpiRoutes);
await app.register(flowRoutes);
await app.register(userRoutes);
await app.register(projectRoutes);
await app.register(reportRoutes);
await app.register(authRoutes);
await app.register(roleRoutes);
await app.register(analyzeRoutes);

app.get("/api/health", async () => ({ ok: true }));

// In production the built dashboard (web/dist) is served by this same
// process — there's no separate frontend host, so login cookies and API
// calls stay same-origin. In dev the web workspace runs its own Vite
// server (proxying /api here instead), so this block only activates when
// web/dist actually exists.
const WEB_DIST_DIR = path.join(__dirname, "..", "..", "web", "dist");
if (fs.existsSync(WEB_DIST_DIR)) {
  await app.register(fastifyStatic, { root: WEB_DIST_DIR, prefix: "/", decorateReply: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith("/api/") || req.raw.url?.startsWith("/screenshots/") || req.raw.url?.startsWith("/reports/")) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html", WEB_DIST_DIR);
  });
}
const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
