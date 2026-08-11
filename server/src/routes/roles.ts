import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { PAGE_KEYS, isPageKey } from "../access/pages.js";

function toPublicRole<T extends { allowedPagesJson: string }>(role: T) {
  const { allowedPagesJson, ...rest } = role;
  return { ...rest, allowedPages: JSON.parse(allowedPagesJson) as string[] };
}

function validatePages(pages: unknown): string[] | null {
  if (!Array.isArray(pages) || !pages.length) return null;
  if (!pages.every(isPageKey)) return null;
  return Array.from(new Set(pages));
}

export async function roleRoutes(app: FastifyInstance) {
  app.get("/api/roles", async () => {
    const roles = await prisma.role.findMany({ orderBy: { createdAt: "desc" } });
    return roles.map(toPublicRole);
  });

  app.get("/api/roles/pages", async () => PAGE_KEYS);

  app.post("/api/roles", async (req, reply) => {
    const body = req.body as { name: string; description?: string; allowedPages: unknown };
    if (!body.name) return reply.code(400).send({ error: "name is required" });

    const allowedPages = validatePages(body.allowedPages);
    if (!allowedPages) return reply.code(400).send({ error: "allowedPages must be a non-empty array of valid page keys" });

    const existing = await prisma.role.findUnique({ where: { name: body.name } });
    if (existing) return reply.code(409).send({ error: "a role with this name already exists" });

    const role = await prisma.role.create({
      data: { name: body.name, description: body.description || null, allowedPagesJson: JSON.stringify(allowedPages) },
    });
    return reply.code(201).send(toPublicRole(role));
  });

  app.patch("/api/roles/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string; allowedPages?: unknown };

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description || null;
    if (body.allowedPages !== undefined) {
      const allowedPages = validatePages(body.allowedPages);
      if (!allowedPages) return reply.code(400).send({ error: "allowedPages must be a non-empty array of valid page keys" });
      data.allowedPagesJson = JSON.stringify(allowedPages);
    }

    try {
      const role = await prisma.role.update({ where: { id }, data });
      return toPublicRole(role);
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });

  app.delete("/api/roles/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.role.delete({ where: { id } }).catch(() => null);
    return reply.code(204).send();
  });
}
