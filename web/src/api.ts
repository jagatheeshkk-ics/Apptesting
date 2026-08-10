const BASE = "/api";

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  label: string;
  targetUrl: string;
  username: string;
  role: string | null;
  createdAt: string;
}

export interface TestRun {
  id: string;
  targetUrl: string;
  accountId: string | null;
  account: Account | null;
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
  | "flow";

export interface TestCase {
  id: string;
  category: TestCategory;
  name: string;
  description: string;
  inputJson: string | null;
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
  createdAt: string;
  steps: FlowStep[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export const api = {
  listAccounts: () => fetch(`${BASE}/accounts`).then((r) => json<Account[]>(r)),
  createAccount: (data: { label: string; targetUrl: string; username: string; password: string; role?: string }) =>
    fetch(`${BASE}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<Account>(r)),
  deleteAccount: (id: string) => fetch(`${BASE}/accounts/${id}`, { method: "DELETE" }),

  listTestRuns: () => fetch(`${BASE}/test-runs`).then((r) => json<TestRun[]>(r)),
  getTestRun: (id: string) => fetch(`${BASE}/test-runs/${id}`).then((r) => json<TestRunDetail>(r)),
  createTestRun: (data: { targetUrl: string; accountId?: string; mode?: "full" | "quick" }) =>
    fetch(`${BASE}/test-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<TestRun>(r)),

  accountKpis: () => fetch(`${BASE}/kpi/accounts`).then((r) => json<AccountKpi[]>(r)),
  agentKpi: () => fetch(`${BASE}/kpi/agent`).then((r) => json<AgentPerformanceKpi>(r)),

  listFlows: () => fetch(`${BASE}/flows`).then((r) => json<TestFlow[]>(r)),
  createFlow: (data: {
    label: string;
    targetUrl: string;
    accountId?: string;
    steps: { action: FlowAction; selector?: string; value?: string }[];
  }) =>
    fetch(`${BASE}/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<TestFlow>(r)),
  deleteFlow: (id: string) => fetch(`${BASE}/flows/${id}`, { method: "DELETE" }),

  listUsers: () => fetch(`${BASE}/users`).then((r) => json<User[]>(r)),
  createUser: (data: { username: string; displayName?: string; email?: string; password: string }) =>
    fetch(`${BASE}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<User>(r)),
  updateUser: (id: string, data: { username?: string; displayName?: string; email?: string; password?: string }) =>
    fetch(`${BASE}/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<User>(r)),
  deleteUser: (id: string) => fetch(`${BASE}/users/${id}`, { method: "DELETE" }),
};
