import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function accountRoutes(app: FastifyInstance) {
  app.get("/api/accounts", async () => {
    const accounts = await prisma.account.findMany({ include: { project: true }, orderBy: { createdAt: "desc" } });
    return accounts.map(({ password, ...rest }) => rest);
  });

  app.post("/api/accounts", async (req, reply) => {
    const body = req.body as {
      label: string;
      targetUrl: string;
      username: string;
      password: string;
      role?: string;
      projectId?: string;
    };
    if (!body.label || !body.targetUrl || !body.username || !body.password) {
      return reply.code(400).send({ error: "label, targetUrl, username, password are required" });
    }
    const account = await prisma.account.create({
      data: {
        label: body.label,
        targetUrl: body.targetUrl,
        username: body.username,
        password: body.password,
        role: body.role || null,
        projectId: body.projectId || null,
      },
      include: { project: true },
    });
    const { password, ...rest } = account;
    return rest;
  });

  app.delete("/api/accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.account.delete({ where: { id } }).catch(() => null);
    return reply.code(204).send();
  });
}
