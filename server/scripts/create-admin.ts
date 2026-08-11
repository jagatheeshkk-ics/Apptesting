// One-off bootstrap script: creates (or updates) a user with a "Super Admin"
// role that has every dashboard page allowed, and marks their email
// pre-verified so they can log in immediately without the code-verification
// step. Safe to re-run — it upserts by email.
//
// Usage (from server/): npx tsx scripts/create-admin.ts <email> <password> [username] [displayName]
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/auth/password.js";
import { PAGE_KEYS } from "../src/access/pages.js";

async function main() {
  const [email, password, username, displayName] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/create-admin.ts <email> <password> [username] [displayName]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password should be at least 8 characters.");
    process.exit(1);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const resolvedUsername = username || normalizedEmail.split("@")[0];

  const role = await prisma.role.upsert({
    where: { name: "Super Admin" },
    update: { allowedPagesJson: JSON.stringify(PAGE_KEYS) },
    create: {
      name: "Super Admin",
      description: "Full access to every dashboard page",
      allowedPagesJson: JSON.stringify(PAGE_KEYS),
    },
  });

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {
      passwordHash,
      roleId: role.id,
      emailVerifiedAt: new Date(),
      verificationCodeHash: null,
      verificationCodeExpiresAt: null,
      verificationAttempts: 0,
    },
    create: {
      username: resolvedUsername,
      displayName: displayName || "Super Admin",
      email: normalizedEmail,
      passwordHash,
      roleId: role.id,
      emailVerifiedAt: new Date(),
    },
  });

  console.log(`Superadmin ready: ${user.email} (username: ${user.username}, role: ${role.name})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
