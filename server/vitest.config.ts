import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // buildApp() reads process.env at build time and the rate limiter keeps
    // in-memory per-instance state — keep test files sequential so one file's
    // env tweaks and rate-limit buckets can't bleed into another.
    fileParallelism: false,
    env: {
      AUTH_ENABLED: "true",
      AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
    },
  },
});
