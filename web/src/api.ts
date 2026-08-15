const BASE = "/api";

export type PageKey =
  | "new-test-run"
  | "test-runs"
  | "projects"
  | "accounts"
  | "flows"
  | "users"
  | "roles"
  | "reports"
  | "kpi";

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

export interface Role {
  id: string;
  name: string;
  description: string | null;
  allowedPages: PageKey[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  roleId: string | null;
  role: Role | null;
  createdAt: string;
  updatedAt: string;
  emailVerifiedAt: string | null;
}

export interface ProjectModule {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  modules: ProjectModule[];
}

export interface Account {
  id: string;
  label: string;
  targetUrl: string;
  username: string;
  role: string | null;
  projectId: string | null;
  createdAt: string;
}

export interface TestRun {
  id: string;
  targetUrl: string;
  accountId: string | null;
  account: Account | null;
  projectId: string | null;
  project: Project | null;
  mode: "full" | "quick";
  status: string;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  reportPath: string | null;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
}

export interface TestResult {
  id: string;
  status: "pass" | "fail" | "error";
  severity: string | null;
  actual: string;
  screenshotPath: string | null;
  durationMs: number;
}

export interface StressMetric {
  concurrency: number;
  totalRequests: number;
  errorCount: number;
  errorRatePct: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export interface PerformanceMetric {
  domContentLoadedMs: number;
  loadEventMs: number;
  resourceCount: number;
  transferSizeKb: number;
}

export interface FlowStepResult {
  order: number;
  action: string;
  status: "pass" | "fail" | "error";
  detail: string;
  screenshotPath: string | null;
  durationMs: number;
}

export type TestCategory =
  | "smoke"
  | "boundary"
  | "vulnerability"
  | "stress"
  | "performance"
  | "compatibility"
  | "accessibility"
  | "flow"
  | "story";

export const TEST_CATEGORY_LABELS: Record<TestCategory, string> = {
  smoke: "Smoke",
  boundary: "Boundary value",
  vulnerability: "Vulnerability (security)",
  stress: "Stress / load",
  performance: "Performance",
  compatibility: "Compatibility (viewport)",
  accessibility: "Accessibility",
  flow: "Flows (integration/UAT)",
  story: "Custom test stories",
};

export const ALL_TEST_CATEGORIES = Object.keys(TEST_CATEGORY_LABELS) as TestCategory[];

export interface DetectedField {
  name: string;
  label?: string;
  type: string;
  required: boolean;
  maxLength?: number;
  minLength?: number;
  min?: number;
  max?: number;
  options?: string[];
}

// Some apps give several distinct pages the same generic <title> (e.g.
// every page titled after the site itself), so a module's name alone isn't
// a reliable identity — two modules with the same name but different URLs
// are different modules. Anywhere module story data is keyed for
// lookup/submission, key on this composite instead of name alone, or one
// module's data silently overwrites the other's.
export function moduleKey(name: string, url: string): string {
  return `${name}::${url}`;
}

export interface AnalyzedModule {
  name: string;
  url: string;
  type: "page" | "form" | "nav";
  fields: DetectedField[];
  userStories: string[];
  storiesSource: "previous" | "none";
}

export interface RequiredDetail {
  key: string;
  question: string;
}

export interface RunModule {
  id: string;
  name: string;
  url: string;
  type: string;
  userStories: string[];
}

export type TestType = "positive" | "negative";

export interface TestCase {
  id: string;
  category: TestCategory;
  name: string;
  description: string;
  inputJson: string | null;
  expectation: string | null;
  testType: TestType;
  result: TestResult | null;
  stressMetric?: StressMetric | null;
  performanceMetric?: PerformanceMetric | null;
  flowStepResults?: FlowStepResult[];
}

export interface RegressionEntry {
  category: string;
  name: string;
  previousStatus: string;
  currentStatus: string;
}

export interface RegressionSummary {
  previousRunId: string | null;
  regressed: RegressionEntry[];
  fixed: RegressionEntry[];
}

export interface TestRunDetail extends TestRun {
  testCases: TestCase[];
  regressions: RegressionSummary | null;
  modules: RunModule[];
  enabledCategories: TestCategory[] | null;
}

export interface AccountKpi {
  accountId: string;
  label: string;
  role: string | null;
  totalRuns: number;
  totalCases: number;
  passRate: number;
  vulnerabilitiesFound: number;
  avgResponseMs: number | null;
  errorEventCount: number;
  avgStressErrorRatePct: number | null;
  avgStressP95LatencyMs: number | null;
  accessibilityIssuesFound: number;
  performanceIssuesFound: number;
  lastRunAt: string | null;
}

export interface AgentPerformanceKpi {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  avgRunDurationMs: number | null;
  totalVulnerabilitiesFound: number;
  vulnerabilitiesBySeverity: Record<string, number>;
  totalStressTests: number;
  avgStressErrorRatePct: number | null;
  avgStressP95LatencyMs: number | null;
  totalAccessibilityIssues: number;
  totalPerformanceIssues: number;
  totalFlowRuns: number;
  flowPassRate: number | null;
  runsOverTime: { date: string; runs: number; vulnerabilities: number }[];
}

export interface CategoryIssueBreakdown {
  category: TestCategory;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  issues: number;
}

export interface DashboardTrendPoint {
  period: string;
  runs: number;
  issues: number;
}

export interface DashboardSummary {
  totalRuns: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  passRate: number;
  totalIssues: number;
  issuesByCategory: CategoryIssueBreakdown[];
  trend: DashboardTrendPoint[];
  filterOptions: {
    projects: { id: string; name: string }[];
    accounts: { id: string; label: string }[];
  };
}

export interface DashboardFilters {
  projectId?: string; // pass "unassigned" for the Unassigned bucket
  accountId?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  groupBy?: "day" | "week";
}

export type FlowAction =
  | "navigate"
  | "fill"
  | "click"
  | "expectUrlContains"
  | "expectTextContains"
  | "expectElementVisible";

export interface FlowStep {
  order: number;
  action: FlowAction;
  selector: string | null;
  value: string | null;
}

export interface TestFlow {
  id: string;
  label: string;
  targetUrl: string;
  accountId: string | null;
  account: Account | null;
  projectId: string | null;
  project: Project | null;
  createdAt: string;
  steps: FlowStep[];
}

export interface ModuleBreakdown {
  moduleName: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
}

export interface ProjectKpi {
  projectId: string | null;
  name: string;
  description: string | null;
  definedModules: { id: string; name: string; description: string | null }[];
  totalRuns: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  passRate: number;
  vulnerabilitiesFound: number;
  moduleBreakdown: ModuleBreakdown[];
  lastRunAt: string | null;
}

export interface ProjectKpiSummary {
  grandTotalRuns: number;
  grandTotalCases: number;
  grandPassedCases: number;
  grandFailedCases: number;
  grandErrorCases: number;
  projects: ProjectKpi[];
}

export interface TestCaseReportRow {
  id: string;
  category: TestCategory;
  name: string;
  expectation: string | null;
  testType: TestType;
  module: { name: string } | null;
  result: {
    status: "pass" | "fail" | "error";
    severity: string | null;
    actual: string;
    durationMs: number;
    createdAt: string;
  } | null;
  testRun: {
    targetUrl: string;
    account: { label: string } | null;
    project: { name: string } | null;
  };
}

export interface TestCaseReportSummary {
  filters: { dateFrom: string | null; dateTo: string | null; moduleNames: string[] };
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  testCases: TestCaseReportRow[];
}

export interface ReportSearchParams {
  dateFrom?: string;
  dateTo?: string;
  modules?: string[];
}

function reportQueryString(params: ReportSearchParams): string {
  const qs = new URLSearchParams();
  if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
  if (params.dateTo) qs.set("dateTo", params.dateTo);
  (params.modules ?? []).forEach((m) => qs.append("module", m));
  return qs.toString();
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export const api = {
  listAccounts: () => fetch(`${BASE}/accounts`).then((r) => json<Account[]>(r)),
  createAccount: (data: {
    label: string;
    targetUrl: string;
    username: string;
    password: string;
    role?: string;
    projectId?: string;
  }) =>
    fetch(`${BASE}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<Account>(r)),
  deleteAccount: (id: string) => fetch(`${BASE}/accounts/${id}`, { method: "DELETE" }),

  listTestRuns: () => fetch(`${BASE}/test-runs`).then((r) => json<TestRun[]>(r)),
  getTestRun: (id: string) => fetch(`${BASE}/test-runs/${id}`).then((r) => json<TestRunDetail>(r)),
  createTestRun: (data: {
    targetUrl: string;
    accountId?: string;
    projectId?: string;
    mode?: "full" | "quick";
    enabledCategories?: TestCategory[];
    moduleStories?: Record<string, string[]>;
    testStories?: string;
    username?: string;
    password?: string;
    saveAsAccount?: boolean;
    accountLabel?: string;
  }) =>
    fetch(`${BASE}/test-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<TestRun>(r)),

  analyzeUrl: (data: { targetUrl: string; accountId?: string; username?: string; password?: string }) =>
    fetch(`${BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<{ modules: AnalyzedModule[]; requiresLogin: boolean }>(r)),

  generateModuleStories: (modules: { name: string; url: string; type: string; fields: DetectedField[] }[]) =>
    fetch(`${BASE}/analyze/generate-stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modules }),
    }).then((r) => json<{ userStories: Record<string, string[]> }>(r)),

  storyRequirements: (data: {
    testStories: string;
    modules: { name: string; url: string; type: string; fields: DetectedField[] }[];
  }) =>
    fetch(`${BASE}/analyze/story-requirements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<{ requiredDetails: RequiredDetail[] }>(r)),

  accountKpis: () => fetch(`${BASE}/kpi/accounts`).then((r) => json<AccountKpi[]>(r)),
  agentKpi: () => fetch(`${BASE}/kpi/agent`).then((r) => json<AgentPerformanceKpi>(r)),
  projectKpis: () => fetch(`${BASE}/kpi/projects`).then((r) => json<ProjectKpiSummary>(r)),
  dashboardSummary: (filters: DashboardFilters) => {
    const params = new URLSearchParams();
    if (filters.projectId) params.set("projectId", filters.projectId);
    if (filters.accountId) params.set("accountId", filters.accountId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.groupBy) params.set("groupBy", filters.groupBy);
    const qs = params.toString();
    return fetch(`${BASE}/kpi/dashboard${qs ? `?${qs}` : ""}`).then((r) => json<DashboardSummary>(r));
  },

  listFlows: () => fetch(`${BASE}/flows`).then((r) => json<TestFlow[]>(r)),
  createFlow: (data: {
    label: string;
    targetUrl: string;
    accountId?: string;
    projectId?: string;
    steps: { action: FlowAction; selector?: string; value?: string }[];
  }) =>
    fetch(`${BASE}/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<TestFlow>(r)),
  deleteFlow: (id: string) => fetch(`${BASE}/flows/${id}`, { method: "DELETE" }),

  listProjects: () => fetch(`${BASE}/projects`).then((r) => json<Project[]>(r)),
  createProject: (data: { name: string; description?: string }) =>
    fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<Project>(r)),
  deleteProject: (id: string) => fetch(`${BASE}/projects/${id}`, { method: "DELETE" }),
  addProjectModule: (projectId: string, data: { name: string; description?: string }) =>
    fetch(`${BASE}/projects/${projectId}/modules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<ProjectModule>(r)),
  deleteProjectModule: (projectId: string, moduleId: string) =>
    fetch(`${BASE}/projects/${projectId}/modules/${moduleId}`, { method: "DELETE" }),

  listUsers: () => fetch(`${BASE}/users`).then((r) => json<User[]>(r)),
  createUser: (data: { username: string; displayName?: string; email: string; password: string; roleId?: string }) =>
    fetch(`${BASE}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<User>(r)),
  updateUser: (
    id: string,
    data: { username?: string; displayName?: string; email?: string; password?: string; roleId?: string | null },
  ) =>
    fetch(`${BASE}/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<User>(r)),
  deleteUser: (id: string) => fetch(`${BASE}/users/${id}`, { method: "DELETE" }),

  listRoles: () => fetch(`${BASE}/roles`).then((r) => json<Role[]>(r)),
  createRole: (data: { name: string; description?: string; allowedPages: PageKey[] }) =>
    fetch(`${BASE}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<Role>(r)),
  updateRole: (id: string, data: { name?: string; description?: string; allowedPages?: PageKey[] }) =>
    fetch(`${BASE}/roles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<Role>(r)),
  deleteRole: (id: string) => fetch(`${BASE}/roles/${id}`, { method: "DELETE" }),

  listReportModules: () => fetch(`${BASE}/reports/modules`).then((r) => json<string[]>(r)),
  searchTestCaseReport: (params: ReportSearchParams) =>
    fetch(`${BASE}/reports/test-cases?${reportQueryString(params)}`).then((r) => json<TestCaseReportSummary>(r)),
  reportExportUrl: (params: ReportSearchParams) => `${BASE}/reports/test-cases/export?${reportQueryString(params)}`,
  reportExportXlsxUrl: (params: ReportSearchParams) =>
    `${BASE}/reports/test-cases/export.xlsx?${reportQueryString(params)}`,
  testRunReportXlsxUrl: (testRunId: string) => `${BASE}/test-runs/${testRunId}/report.xlsx`,

  authStatus: () => fetch(`${BASE}/auth/status`).then((r) => json<{ enabled: boolean }>(r)),
  me: () => fetch(`${BASE}/auth/me`, { credentials: "include" }),
  login: (data: { email: string; password: string }) =>
    fetch(`${BASE}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  verifyEmail: (data: { userId: string; code: string }) =>
    fetch(`${BASE}/auth/verify-email`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  resendCode: (userId: string) =>
    fetch(`${BASE}/auth/resend-code`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }),
  logout: () => fetch(`${BASE}/auth/logout`, { method: "POST", credentials: "include" }),
};
