import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { hashPassword } from "../auth/password.js";
import { toPublicUser } from "../auth/publicUser.js";

export async function userRoutes(app: FastifyInstance) {
  app.get("/api/users", async () => {
    const users = await prisma.user.findMany({ include: { role: true }, orderBy: { createdAt: "desc" } });
    return users.map(toPublicUser);
  });

  app.post("/api/users", async (req, reply) => {
    const body = req.body as { username: string; displayName?: string; email: string; password: string; roleId?: string };
    if (!body.username || !body.email || !body.password) {
      return reply.code(400).send({ error: "username, email, and password are required" });
    }

    const email = body.email.trim().toLowerCase();
    const [existingUsername, existingEmail] = await Promise.all([
      prisma.user.findUnique({ where: { username: body.username } }),
      prisma.user.findUnique({ where: { email } }),
    ]);
    if (existingUsername) return reply.code(409).send({ error: "username already exists" });
    if (existingEmail) return reply.code(409).send({ error: "email already in use" });

    const user = await prisma.user.create({
      data: {
        username: body.username,
        displayName: body.displayName || null,
        email,
        passwordHash: await hashPassword(body.password),
        roleId: body.roleId || null,
      },
      include: { role: true },
    });
    return reply.code(201).send(toPublicUser(user));
  });

  app.patch("/api/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      username?: string;
      displayName?: string;
      email?: string;
      password?: string;
      roleId?: string | null;
    };

    const data: Record<string, unknown> = {};
    if (body.username !== undefined) data.username = body.username;
    if (body.displayName !== undefined) data.displayName = body.displayName || null;
    if (body.password) data.passwordHash = await hashPassword(body.password);
    if (body.roleId !== undefined) data.roleId = body.roleId || null;

    if (body.email !== undefined) {
      const email = body.email.trim().toLowerCase();
      const current = await prisma.user.findUnique({ where: { id } });
      if (!current) return reply.code(404).send({ error: "not found" });
      if (email !== current.email) {
        // changing the mailbox invalidates prior verification — they must re-verify.
        data.email = email;
        data.emailVerifiedAt = null;
        data.verificationCodeHash = null;
        data.verificationCodeExpiresAt = null;
        data.verificationAttempts = 0;
      }
    }

    try {
      const user = await prisma.user.update({ where: { id }, data, include: { role: true } });
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
