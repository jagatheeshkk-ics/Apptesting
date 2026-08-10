import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

const VALID_ACTIONS = new Set([
  "navigate",
  "fill",
  "click",
  "expectUrlContains",
  "expectTextContains",
  "expectElementVisible",
]);

interface StepInput {
  action: string;
  selector?: string;
  value?: string;
}

export async function flowRoutes(app: FastifyInstance) {
  app.get("/api/flows", async () => {
    return prisma.testFlow.findMany({
      include: { steps: { orderBy: { order: "asc" } }, account: true },
      orderBy: { createdAt: "desc" },
    });
  });

  app.get("/api/flows/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const flow = await prisma.testFlow.findUnique({
      where: { id },
      include: { steps: { orderBy: { order: "asc" } }, account: true },
    });
    if (!flow) return reply.code(404).send({ error: "not found" });
    return flow;
  });

  app.post("/api/flows", async (req, reply) => {
    const body = req.body as { label: string; targetUrl: string; accountId?: string; steps: StepInput[] };
    if (!body.label || !body.targetUrl || !Array.isArray(body.steps) || !body.steps.length) {
      return reply.code(400).send({ error: "label, targetUrl, and at least one step are required" });
    }
    for (const s of body.steps) {
      if (!VALID_ACTIONS.has(s.action)) {
        return reply.code(400).send({ error: `invalid step action "${s.action}"` });
      }
    }

    const flow = await prisma.testFlow.create({
      data: {
        label: body.label,
        targetUrl: body.targetUrl,
        accountId: body.accountId || null,
        steps: {
          create: body.steps.map((s, i) => ({
            order: i,
            action: s.action,
            selector: s.selector || null,
            value: s.value || null,
          })),
        },
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });

    return flow;
  });

  app.delete("/api/flows/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.testFlow.delete({ where: { id } }).catch(() => null);
    return reply.code(204).send();
  });
}
