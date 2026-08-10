import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async () => {
    return prisma.project.findMany({
      include: { modules: { orderBy: { name: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
  });

  app.get("/api/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id },
      include: { modules: { orderBy: { name: "asc" } } },
    });
    if (!project) return reply.code(404).send({ error: "not found" });
    return project;
  });

  app.post("/api/projects", async (req, reply) => {
    const body = req.body as { name: string; description?: string };
    if (!body.name) return reply.code(400).send({ error: "name is required" });

    const existing = await prisma.project.findUnique({ where: { name: body.name } });
    if (existing) return reply.code(409).send({ error: "a project with this name already exists" });

    const project = await prisma.project.create({
      data: { name: body.name, description: body.description || null },
      include: { modules: true },
    });
    return reply.code(201).send(project);
  });

  app.patch("/api/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string };
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description || null;

    try {
      return await prisma.project.update({ where: { id }, data, include: { modules: true } });
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });

  app.delete("/api/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.project.delete({ where: { id } }).catch(() => null);
    return reply.code(204).send();
  });

  app.post("/api/projects/:id/modules", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name: string; description?: string };
    if (!body.name) return reply.code(400).send({ error: "name is required" });

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: "project not found" });

    const existing = await prisma.projectModule.findFirst({ where: { projectId: id, name: body.name } });
    if (existing) return reply.code(409).send({ error: "a module with this name already exists in this project" });

    const projectModule = await prisma.projectModule.create({
      data: { projectId: id, name: body.name, description: body.description || null },
    });
    return reply.code(201).send(projectModule);
  });

  app.delete("/api/projects/:id/modules/:moduleId", async (req, reply) => {
    const { id, moduleId } = req.params as { id: string; moduleId: string };
    await prisma.projectModule.deleteMany({ where: { id: moduleId, projectId: id } });
    return reply.code(204).send();
  });
}
