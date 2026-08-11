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
import { registerAuthGate } from "./auth/gate.js";
import { REPORT_DIR, SCREENSHOT_DIR } from "./agent/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

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
