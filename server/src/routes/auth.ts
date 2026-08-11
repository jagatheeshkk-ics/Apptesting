import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { sendVerificationEmail } from "../auth/mailer.js";
import { SESSION_COOKIE, createSessionToken, generateVerificationCode, verifySessionToken } from "../auth/session.js";
import { toPublicUser } from "../auth/publicUser.js";

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

async function issueVerificationCode(userId: string, email: string) {
  const code = generateVerificationCode();
  await prisma.user.update({
    where: { id: userId },
    data: {
      verificationCodeHash: await hashPassword(code),
      verificationCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
      verificationAttempts: 0,
    },
  });
  await sendVerificationEmail(email, code);
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/api/auth/status", async () => ({ enabled: process.env.AUTH_ENABLED === "true" }));

  app.get("/api/auth/me", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    const userId = token ? verifySessionToken(token) : null;
    if (!userId) return reply.code(401).send({ error: "not authenticated" });

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!user) return reply.code(401).send({ error: "not authenticated" });
    return { user: toPublicUser(user) };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = req.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.code(400).send({ error: "email and password are required" });
    }

    const email = body.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
    const invalid = () => reply.code(401).send({ error: "invalid email or password" });
    if (!user) return invalid();

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return invalid();

    if (!user.emailVerifiedAt) {
      await issueVerificationCode(user.id, user.email);
      return reply.send({ status: "verification_required", userId: user.id, email: user.email });
    }

    const token = createSessionToken(user.id);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isProduction(),
      maxAge: 30 * 24 * 60 * 60,
    });
    return { status: "ok", user: toPublicUser(user) };
  });

  app.post("/api/auth/verify-email", async (req, reply) => {
    const body = req.body as { userId?: string; code?: string };
    if (!body.userId || !body.code) {
      return reply.code(400).send({ error: "userId and code are required" });
    }

    const user = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!user) return reply.code(400).send({ error: "invalid verification request" });
    if (user.emailVerifiedAt) return reply.code(400).send({ error: "email already verified" });
    if (!user.verificationCodeHash || !user.verificationCodeExpiresAt) {
      return reply.code(400).send({ error: "no pending verification — request a new code" });
    }
    if (Date.now() > user.verificationCodeExpiresAt.getTime()) {
      return reply.code(400).send({ error: "verification code expired — request a new code" });
    }
    if (user.verificationAttempts >= MAX_VERIFY_ATTEMPTS) {
      return reply.code(429).send({ error: "too many attempts — request a new code" });
    }

    const ok = await verifyPassword(body.code, user.verificationCodeHash);
    if (!ok) {
      await prisma.user.update({ where: { id: user.id }, data: { verificationAttempts: { increment: 1 } } });
      return reply.code(400).send({ error: "invalid verification code" });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        verificationCodeHash: null,
        verificationCodeExpiresAt: null,
        verificationAttempts: 0,
      },
      include: { role: true },
    });

    const token = createSessionToken(updated.id);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isProduction(),
      maxAge: 30 * 24 * 60 * 60,
    });
    return { status: "ok", user: toPublicUser(updated) };
  });

  app.post("/api/auth/resend-code", async (req, reply) => {
    const body = req.body as { userId?: string };
    if (!body.userId) return reply.code(400).send({ error: "userId is required" });

    const user = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!user) return reply.code(400).send({ error: "invalid request" });
    if (user.emailVerifiedAt) return reply.code(400).send({ error: "email already verified" });

    if (user.verificationCodeExpiresAt) {
      const issuedAt = user.verificationCodeExpiresAt.getTime() - CODE_TTL_MS;
      if (Date.now() - issuedAt < RESEND_COOLDOWN_MS) {
        return reply.code(429).send({ error: "please wait a moment before requesting another code" });
      }
    }

    await issueVerificationCode(user.id, user.email);
    return { status: "ok" };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { status: "ok" };
  });
}
