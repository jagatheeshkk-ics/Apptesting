import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BuildAppOptions {
  /** Fastify logger config — pass `false` in tests to silence output. */
  logger?: FastifyServerOptions["logger"];
}

/**
 * Builds the fully-configured Fastify instance (error handler, CORS, cookies,
 * rate limiting, auth gate, routes, static assets) but does NOT call `.listen()`.
 * `index.ts` starts the listener; tests drive it with `app.inject()`.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  if (process.env.AUTH_ENABLED === "true" && !process.env.AUTH_SECRET) {
    throw new Error(
      "AUTH_ENABLED=true but AUTH_SECRET is not set — set AUTH_SECRET to a long random string.",
    );
  }

  // trustProxy: on Render (and any reverse proxy) the client IP arrives in
  // X-Forwarded-For — the rate limiter and logs need the real IP, not the proxy's.
  // ajv: turn OFF type coercion and additional-property stripping so a body that
  // doesn't match its schema is rejected outright (a 400) instead of being
  // quietly reshaped. No route relies on coercion — only the auth routes carry
  // body schemas at all.
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: true,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  // Errors must not leak internals. Validation failures -> a generic 400;
  // anything 5xx (DB down, unexpected throw) -> logged in full server-side but
  // returned to the client as a bare message with no stack, path, or query text.
  app.setErrorHandler((error, req, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: "invalid request payload" });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      req.log.error(error);
      return reply.code(status).send({ error: "internal server error" });
    }
    return reply.code(status).send({ error: error.message });
  });

  // CORS is off unless CORS_ORIGINS (comma-separated) is set. The dashboard is
  // served same-origin in production and proxied through Vite in dev, so no
  // cross-origin access is needed by default — `origin: true` + credentials
  // would let any site make credentialed calls and read the responses.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });
  await app.register(fastifyCookie);
  // Per-route limits only (see routes/auth.ts). In-memory store — fine for the
  // single-instance Render deploy; move to a shared store if scaled out.
  // The default 429 error ("Rate limit exceeded, retry in …") carries no
  // sensitive detail, so the error handler above passes it straight through.
  await app.register(rateLimit, { global: false });
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

  await app.ready();
  return app;
}
