import { FastifyInstance } from "fastify";
import { SESSION_COOKIE, verifySessionToken } from "./session.js";

// Paths reachable without a session even when AUTH_ENABLED=true.
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/health"];

export function registerAuthGate(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (process.env.AUTH_ENABLED !== "true") return;
    if (!req.url.startsWith("/api/")) return;
    if (PUBLIC_API_PREFIXES.some((p) => req.url.startsWith(p))) return;

    const token = req.cookies[SESSION_COOKIE];
    const userId = token ? verifySessionToken(token) : null;
    if (!userId) {
      reply.code(401).send({ error: "authentication required" });
    }
  });
}
