import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakePrisma, resetStore, seedUser, makeRole, store } from "./fakeDb.js";

// The auth routes and the auth gate both `import { prisma } from "../db.js"` —
// swap it for the in-memory fake. The mailer would otherwise console.log every
// verification code during tests, so silence it too.
vi.mock("../src/db.js", async () => {
  const { fakePrisma } = await import("./fakeDb.js");
  return { prisma: fakePrisma };
});
vi.mock("../src/auth/mailer.js", () => ({ sendVerificationEmail: vi.fn(async () => {}) }));

const { buildApp } = await import("../src/app.js");
const { SESSION_COOKIE, createSessionToken } = await import("../src/auth/session.js");
const { sendVerificationEmail } = await import("../src/auth/mailer.js");

let app: FastifyInstance;

async function makeApp(): Promise<FastifyInstance> {
  return buildApp({ logger: false });
}

function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url, payload: payload as object, headers });
}
function get(url: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "GET", url, headers });
}
/** Cookie header carrying a valid session token for `userId`. */
function auth(userId: string) {
  return { cookie: `${SESSION_COOKIE}=${createSessionToken(userId)}` };
}

beforeEach(async () => {
  resetStore();
  vi.mocked(sendVerificationEmail).mockClear();
  delete process.env.CORS_ORIGINS;
  app = await makeApp();
});

afterEach(async () => {
  await app.close().catch(() => {});
});

// ---------------------------------------------------------------------------
// D1 — input validation & error disclosure
// ---------------------------------------------------------------------------
describe("D1 — validation & no internal disclosure", () => {
  it("missing email/password -> 400 with the friendly message", async () => {
    for (const body of [{}, { email: "a@b.com" }, { password: "x" }]) {
      const res = await post("/api/auth/login", body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "email and password are required" });
    }
  });

  it("non-string email/password is rejected with the generic 400, never a TypeError 500", async () => {
    for (const email of [123, { a: 1 }, ["a@b.com"], true, null]) {
      const res = await post("/api/auth/login", { email, password: "x" });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid request payload" });
    }
    expect((await post("/api/auth/login", { email: "a@b.com", password: 999 })).statusCode).toBe(400);
  });

  it("unknown top-level fields are rejected", async () => {
    const res = await post("/api/auth/login", { email: "a@b.com", password: "x", role: "admin" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid request payload" });
  });

  it("malformed JSON -> 400, body is just a parser message (no stack/path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{bad",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(Object.keys(body)).toEqual(["error"]);
    // a plain parser message — no file path, driver name, or stack frame
    expect(body.error).not.toMatch(/node_modules|prisma|\.[jt]s:\d|[A-Za-z]:\\|\bat \w+\.\w+/i);
  });

  it("an unexpected handler error surfaces as a generic 500 — no stack, path, query, or driver text", async () => {
    // Force prisma.user.findUnique to blow up the way a dead DB connection would.
    const spy = vi.spyOn(fakePrisma.user, "findUnique").mockRejectedValueOnce(
      new Error("Invalid `prisma.user.findUnique()` invocation in /app/src/routes/auth.ts:51\n  FATAL: tenant not found"),
    );
    const res = await post("/api/auth/login", { email: "someone@example.com", password: "whatever" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal server error" });
    const raw = res.body;
    expect(raw).not.toMatch(/prisma|tenant|invocation|routes[/\\]auth|FATAL|\.ts:/i);
    spy.mockRestore();
  });

  it("verify-email / resend-code reject non-string ids with the generic 400", async () => {
    expect((await post("/api/auth/verify-email", { userId: 1, code: [] })).statusCode).toBe(400);
    expect((await post("/api/auth/resend-code", { userId: {} })).statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// D2 — CORS
// ---------------------------------------------------------------------------
describe("D2 — CORS is closed by default, allowlisted when configured", () => {
  it("no CORS_ORIGINS -> no Access-Control-Allow-Origin for any origin", async () => {
    const res = await get("/api/auth/status", { origin: "https://evil.example.com" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("CORS_ORIGINS set -> only the listed origin is reflected", async () => {
    await app.close();
    process.env.CORS_ORIGINS = "https://dash.example.com, https://ops.example.com";
    app = await makeApp();

    const allowed = await get("/api/auth/status", { origin: "https://dash.example.com" });
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://dash.example.com");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const denied = await get("/api/auth/status", { origin: "https://evil.example.com" });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D3 — rate limiting
// ---------------------------------------------------------------------------
describe("D3 — unauthenticated auth endpoints are rate limited", () => {
  it("login: 11th attempt in the window -> 429 with Retry-After, no detail leak", async () => {
    await seedUser({ email: "rl@example.com", password: "right" });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await post("/api/auth/login", { email: "rl@example.com", password: "wrong" });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);

    const limited = await post("/api/auth/login", { email: "rl@example.com", password: "wrong" });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.body).not.toMatch(/[/\\]|prisma|node_modules/i);
  });

  it("resend-code: caps at 5 per window", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await post("/api/auth/resend-code", { userId: "missing" })).statusCode);
    }
    expect(codes.filter((c) => c === 429)).toHaveLength(1);
    expect(codes[5]).toBe(429);
  });

  it("verify-email: caps at 15 per window", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 16; i++) {
      codes.push((await post("/api/auth/verify-email", { userId: "missing", code: "000000" })).statusCode);
    }
    expect(codes[15]).toBe(429);
  });

  it("the limiter is per-endpoint — hammering login does not 429 the gate", async () => {
    for (let i = 0; i < 11; i++) await post("/api/auth/login", { email: "x@y.com", password: "z" });
    const res = await get("/api/auth/status");
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Login flow — happy paths & credential checks
// ---------------------------------------------------------------------------
describe("login flow", () => {
  it("valid credentials for a verified user -> 200, ok, HttpOnly session cookie", async () => {
    await seedUser({ email: "amy@example.com", password: "s3cret-pass" });
    const res = await post("/api/auth/login", { email: "amy@example.com", password: "s3cret-pass" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    expect(res.json().user.email).toBe("amy@example.com");
    expect(res.json().user).not.toHaveProperty("passwordHash");

    const setCookie = res.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie.join("\n") : String(setCookie);
    expect(cookie).toMatch(new RegExp(`${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("email is trimmed and lower-cased before lookup", async () => {
    await seedUser({ email: "casey@example.com", password: "pw-123456" });
    const res = await post("/api/auth/login", { email: "  CASEY@Example.COM  ", password: "pw-123456" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("wrong password -> 401 with the same generic message as an unknown email", async () => {
    await seedUser({ email: "dee@example.com", password: "the-right-one" });
    const wrongPw = await post("/api/auth/login", { email: "dee@example.com", password: "the-wrong-one" });
    const noUser = await post("/api/auth/login", { email: "ghost@example.com", password: "anything" });
    expect(wrongPw.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(wrongPw.json()).toEqual({ error: "invalid email or password" });
    expect(noUser.json()).toEqual(wrongPw.json());
    expect(wrongPw.headers["set-cookie"]).toBeUndefined();
  });

  it("unverified user -> 200 verification_required, a code is sent, NO session cookie", async () => {
    const u = await seedUser({ email: "newbie@example.com", password: "pw-abcdef", verified: false });
    const res = await post("/api/auth/login", { email: "newbie@example.com", password: "pw-abcdef" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "verification_required", userId: u.id, email: u.email });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(sendVerificationEmail).toHaveBeenCalledOnce();
    // a hashed code with a future expiry was persisted
    expect(store.users[0].verificationCodeHash).toBeTypeOf("string");
    expect(store.users[0].verificationCodeExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------
describe("email verification", () => {
  it("correct code -> 200, marks verified, clears the code, issues a session", async () => {
    const u = await seedUser({ verified: false, verificationCode: "123456" });
    const res = await post("/api/auth/verify-email", { userId: u.id, code: "123456" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    expect(res.headers["set-cookie"]).toMatch(new RegExp(`${SESSION_COOKIE}=`));
    expect(store.users[0].emailVerifiedAt).toBeInstanceOf(Date);
    expect(store.users[0].verificationCodeHash).toBeNull();
  });

  it("wrong code -> 400 and increments the attempt counter", async () => {
    const u = await seedUser({ verified: false, verificationCode: "111111" });
    const res = await post("/api/auth/verify-email", { userId: u.id, code: "999999" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid verification code" });
    expect(store.users[0].verificationAttempts).toBe(1);
  });

  it("too many attempts -> 429 (in-code counter, distinct from the IP limiter)", async () => {
    const u = await seedUser({ verified: false, verificationCode: "222222", verificationAttempts: 5 });
    const res = await post("/api/auth/verify-email", { userId: u.id, code: "222222" });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: "too many attempts — request a new code" });
  });

  it("expired code -> 400", async () => {
    const u = await seedUser({
      verified: false,
      verificationCode: "333333",
      verificationCodeExpiresAt: new Date(Date.now() - 1000),
    });
    const res = await post("/api/auth/verify-email", { userId: u.id, code: "333333" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/expired/);
  });

  it("already-verified user -> 400", async () => {
    const u = await seedUser({ verified: true });
    const res = await post("/api/auth/verify-email", { userId: u.id, code: "123456" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "email already verified" });
  });

  it("unknown userId -> 400, not 500", async () => {
    const res = await post("/api/auth/verify-email", { userId: "nope", code: "123456" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid verification request" });
  });
});

// ---------------------------------------------------------------------------
// resend-code
// ---------------------------------------------------------------------------
describe("resend-code", () => {
  it("honours the 60s cooldown", async () => {
    const u = await seedUser({
      verified: false,
      verificationCode: "444444",
      verificationCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000), // issued just now
    });
    const res = await post("/api/auth/resend-code", { userId: u.id });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatch(/wait a moment/);
  });

  it("issues a fresh code once the cooldown has passed", async () => {
    const u = await seedUser({
      verified: false,
      verificationCode: "555555",
      verificationCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000 - 61_000), // issued 61s ago
    });
    const before = store.users[0].verificationCodeHash;
    const res = await post("/api/auth/resend-code", { userId: u.id });
    expect(res.statusCode).toBe(200);
    expect(sendVerificationEmail).toHaveBeenCalledOnce();
    expect(store.users[0].verificationCodeHash).not.toBe(before);
  });

  it("already-verified user -> 400", async () => {
    const u = await seedUser({ verified: true });
    const res = await post("/api/auth/resend-code", { userId: u.id });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "email already verified" });
  });
});

// ---------------------------------------------------------------------------
// Sessions & the auth gate
// ---------------------------------------------------------------------------
describe("sessions & auth gate", () => {
  it("/api/auth/me: no cookie -> 401", async () => {
    const res = await get("/api/auth/me");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "not authenticated" });
  });

  it("/api/auth/me: garbage or tampered token -> 401", async () => {
    const garbage = await get("/api/auth/me", { cookie: `${SESSION_COOKIE}=not-a-token` });
    expect(garbage.statusCode).toBe(401);

    const forged = Buffer.from(`user-1.${Date.now() + 999_999}.deadbeefdeadbeef`).toString("base64url");
    const tampered = await get("/api/auth/me", { cookie: `${SESSION_COOKIE}=${forged}` });
    expect(tampered.statusCode).toBe(401);
  });

  it("/api/auth/me: valid token for an existing user -> 200 with the public user", async () => {
    const u = await seedUser({ email: "signed-in@example.com" });
    const res = await get("/api/auth/me", auth(u.id));
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe("signed-in@example.com");
    expect(res.json().user).not.toHaveProperty("passwordHash");
  });

  it("/api/auth/me: validly-signed token for a deleted user -> 401", async () => {
    const res = await get("/api/auth/me", auth("user-does-not-exist"));
    expect(res.statusCode).toBe(401);
  });

  it("expired token -> 401", async () => {
    const u = await seedUser();
    const expired = Buffer.from(`${u.id}.${Date.now() - 1000}.x`).toString("base64url");
    const res = await get("/api/auth/me", { cookie: `${SESSION_COOKIE}=${expired}` });
    expect(res.statusCode).toBe(401);
  });

  it("gate: a protected API route is unreachable without a session", async () => {
    const res = await get("/api/test-runs");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "authentication required" });
  });

  it("gate: public prefixes stay open (health, auth/status)", async () => {
    expect((await get("/api/health")).statusCode).toBe(200);
    expect((await get("/api/auth/status")).statusCode).toBe(200);
    expect((await get("/api/auth/status")).json()).toEqual({ enabled: true });
  });

  it("gate + RBAC: role without the page -> 403; role with it -> through", async () => {
    const limited = makeRole(["reports"], "reports-only");
    const u = await seedUser({ email: "limited@example.com", role: limited });
    const denied = await get("/api/test-runs", auth(u.id));
    expect(denied.statusCode).toBe(403);

    const broad = makeRole(["test-runs"], "runs-ok");
    const v = await seedUser({ email: "runs@example.com", role: broad });
    const allowed = await get("/api/test-runs", auth(v.id));
    // past the gate — the route itself then runs (and may 200/500 on its own data needs)
    expect(allowed.statusCode).not.toBe(401);
    expect(allowed.statusCode).not.toBe(403);
  });

  it("gate: a valid request to a gated route slides the session — a fresh cookie is re-issued", async () => {
    // The gate skips /api/auth/* and /api/health, so the slide only happens on
    // genuinely gated routes. `seedUser()` has no role -> the gate lets it through.
    const u = await seedUser();
    const res = await get("/api/test-runs", auth(u.id));
    expect(res.statusCode).not.toBe(401);
    expect(String(res.headers["set-cookie"] ?? "")).toContain(`${SESSION_COOKIE}=`);
  });

  it("logout clears the session cookie", async () => {
    const res = await post("/api/auth/logout", {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.headers["set-cookie"]).toMatch(/apptesting_session=;/);
  });
});
