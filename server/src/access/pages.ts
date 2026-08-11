// Canonical list of the dashboard's nav pages, used both to validate a
// Role's allowedPagesJson and to gate API routes by page (see auth/gate.ts).
export const PAGE_KEYS = [
  "new-test-run",
  "test-runs",
  "projects",
  "accounts",
  "flows",
  "users",
  "roles",
  "reports",
  "kpi",
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];

export const PAGE_LABELS: Record<PageKey, string> = {
  "new-test-run": "New test run",
  "test-runs": "Test runs",
  projects: "Projects",
  accounts: "Accounts",
  flows: "Flows",
  users: "Users",
  roles: "Roles",
  reports: "Reports",
  kpi: "KPI dashboard",
};

export function isPageKey(value: unknown): value is PageKey {
  return typeof value === "string" && (PAGE_KEYS as readonly string[]).includes(value);
}
