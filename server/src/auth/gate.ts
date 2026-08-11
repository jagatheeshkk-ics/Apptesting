import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { SESSION_COOKIE, verifySessionToken } from "./session.js";
import { PageKey } from "../access/pages.js";

// Paths reachable without a session even when AUTH_ENABLED=true.
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/health"];

interface RouteRule {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "*";
  prefix: string;
  page: PageKey;
}

// Maps API routes to the dashboard page they belong to, for role-based
// gating. GET /api/accounts and GET /api/projects are deliberately left
// out — several pages (New test run, Accounts, Flows) depend on those
// lists purely to populate dropdowns, so restricting them by page would
// break cross-page dropdowns for users who are permitted on those other
// pages but not on Accounts/Projects itself. Everything else that's
// specific to one page's own screen is gated.
const ROUTE_RULES: RouteRule[] = [
  { method: "POST", prefix: "/api/test-runs", page: "new-test-run" },
  { method: "GET", prefix: "/api/test-runs", page: "test-runs" },
  { method: "*", prefix: "/api/kpi/projects", page: "projects" },
  { method: "POST", prefix: "/api/projects", page: "projects" },
  { method: "PATCH", prefix: "/api/projects", page: "projects" },
  { method: "DELETE", prefix: "/api/projects", page: "projects" },
  { method: "POST", prefix: "/api/accounts", page: "accounts" },
  { method: "DELETE", prefix: "/api/accounts", page: "accounts" },
  { method: "*", prefix: "/api/flows", page: "flows" },
  { method: "*", prefix: "/api/users", page: "users" },
  { method: "*", prefix: "/api/roles", page: "roles" },
  { method: "*", prefix: "/api/reports", page: "reports" },
  { method: "*", prefix: "/api/kpi/accounts", page: "kpi" },
  { method: "*", prefix: "/api/kpi/agent", page: "kpi" },
];

function matchRule(method: string, url: string): PageKey | null {
  const path = url.split("?")[0];
  for (const rule of ROUTE_RULES) {
    if (!path.startsWith(rule.prefix)) continue;
    if (rule.method !== "*" && rule.method !== method) continue;
    return rule.page;
  }
  return null;
}

export function registerAuthGate(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (process.env.AUTH_ENABLED !== "true") return;
    if (!req.url.startsWith("/api/")) return;
    if (PUBLIC_API_PREFIXES.some((p) => req.url.startsWith(p))) return;

    const token = req.cookies[SESSION_COOKIE];
    const userId = token ? verifySessionToken(token) : null;
    if (!userId) {
      return reply.code(401).send({ error: "authentication required" });
    }

    const requiredPage = matchRule(req.method, req.url);
    if (!requiredPage) return;

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!user) return reply.code(401).send({ error: "authentication required" });
    if (!user.role) return; // no role assigned = unrestricted access

    const allowedPages = JSON.parse(user.role.allowedPagesJson) as string[];
    if (!allowedPages.includes(requiredPage)) {
      reply.code(403).send({ error: `your role does not have access to this page` });
    }
  });
}
