import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import { accountRoutes } from "./routes/accounts.js";
import { testRunRoutes } from "./routes/testRuns.js";
import { kpiRoutes } from "./routes/kpi.js";
import { REPORT_DIR, SCREENSHOT_DIR } from "./agent/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

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

app.get("/api/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
