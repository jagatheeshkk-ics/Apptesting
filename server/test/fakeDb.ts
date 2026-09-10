// A tiny in-memory stand-in for the Prisma client, covering only the calls the
// auth routes and the auth gate make: `prisma.user.findUnique` and
// `prisma.user.update`. Tests seed `store.users` and assert on route behavior
// without a real database.
import { hashPassword } from "../src/auth/password.js";

export interface FakeRole {
  id: string;
  name: string;
  description: string | null;
  allowedPagesJson: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  passwordHash: string;
  roleId: string | null;
  role: FakeRole | null;
  createdAt: Date;
  updatedAt: Date;
  emailVerifiedAt: Date | null;
  verificationCodeHash: string | null;
  verificationCodeExpiresAt: Date | null;
  verificationAttempts: number;
}

export const store: { users: FakeUser[] } = { users: [] };

export function resetStore(): void {
  store.users = [];
}

function findUser(where: Record<string, unknown>): FakeUser | undefined {
  return store.users.find(
    (u) =>
      (where.id !== undefined && u.id === where.id) ||
      (where.email !== undefined && u.email === where.email),
  );
}

export const fakePrisma = {
  user: {
    findUnique: async ({ where }: { where: Record<string, unknown>; include?: unknown }) => {
      const u = findUser(where);
      return u ? structuredClone(u) : null;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
      include?: unknown;
    }) => {
      const u = findUser(where);
      if (!u) {
        const err = new Error("Record to update not found.") as Error & { code: string };
        err.code = "P2025";
        throw err;
      }
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === "object" && "increment" in (value as object)) {
          const current = (u as unknown as Record<string, number>)[key] ?? 0;
          (u as unknown as Record<string, number>)[key] = current + (value as { increment: number }).increment;
        } else {
          (u as unknown as Record<string, unknown>)[key] = value;
        }
      }
      return structuredClone(u);
    },
  },
};

let seq = 0;

export function makeRole(allowedPages: string[], name = `role-${++seq}`): FakeRole {
  return {
    id: `role-id-${seq}`,
    name,
    description: null,
    allowedPagesJson: JSON.stringify(allowedPages),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

export interface MakeUserOptions {
  email?: string;
  password?: string;
  verified?: boolean;
  role?: FakeRole | null;
  verificationCode?: string;
  verificationCodeExpiresAt?: Date | null;
  verificationAttempts?: number;
}

/** Seeds a user into the store and returns it (password hashed with the real scrypt). */
export async function seedUser(opts: MakeUserOptions = {}): Promise<FakeUser> {
  const n = ++seq;
  const password = opts.password ?? "Correct-Horse-1";
  const user: FakeUser = {
    id: `user-${n}`,
    username: `user${n}`,
    displayName: `User ${n}`,
    email: opts.email ?? `user${n}@example.com`,
    passwordHash: await hashPassword(password),
    roleId: opts.role ? opts.role.id : null,
    role: opts.role ?? null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    emailVerifiedAt: opts.verified === false ? null : new Date("2026-01-02T00:00:00Z"),
    verificationCodeHash: opts.verificationCode ? await hashPassword(opts.verificationCode) : null,
    verificationCodeExpiresAt:
      opts.verificationCodeExpiresAt !== undefined
        ? opts.verificationCodeExpiresAt
        : opts.verificationCode
          ? new Date(Date.now() + 15 * 60 * 1000)
          : null,
    verificationAttempts: opts.verificationAttempts ?? 0,
  };
  store.users.push(user);
  return user;
}
