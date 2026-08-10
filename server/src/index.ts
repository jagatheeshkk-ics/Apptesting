import path from "node:path";
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

app.get("/api/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
