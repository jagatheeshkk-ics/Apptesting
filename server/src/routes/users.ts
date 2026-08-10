import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { hashPassword } from "../auth/password.js";

function toPublicUser<T extends { passwordHash: string }>(user: T) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export async function userRoutes(app: FastifyInstance) {
  app.get("/api/users", async () => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
    return users.map(toPublicUser);
  });

  app.post("/api/users", async (req, reply) => {
    const body = req.body as { username: string; displayName?: string; email?: string; password: string };
    if (!body.username || !body.password) {
      return reply.code(400).send({ error: "username and password are required" });
    }

    const existing = await prisma.user.findUnique({ where: { username: body.username } });
    if (existing) return reply.code(409).send({ error: "username already exists" });

    const user = await prisma.user.create({
      data: {
        username: body.username,
        displayName: body.displayName || null,
        email: body.email || null,
        passwordHash: await hashPassword(body.password),
      },
    });
    return reply.code(201).send(toPublicUser(user));
  });

  app.patch("/api/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { username?: string; displayName?: string; email?: string; password?: string };

    const data: Record<string, unknown> = {};
    if (body.username !== undefined) data.username = body.username;
    if (body.displayName !== undefined) data.displayName = body.displayName || null;
    if (body.email !== undefined) data.email = body.email || null;
    if (body.password) data.passwordHash = await hashPassword(body.password);

    try {
      const user = await prisma.user.update({ where: { id }, data });
      return toPublicUser(user);
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });

  app.delete("/api/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.user.delete({ where: { id } }).catch(() => null);
    return reply.code(204).send();
  });
}
