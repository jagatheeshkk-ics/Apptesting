import { FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { SESSION_COOKIE, verifySessionToken } from "./session.js";

export async function getCurrentUsername(req: FastifyRequest): Promise<string | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  const userId = token ? verifySessionToken(token) : null;
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.displayName || user?.username || null;
}
