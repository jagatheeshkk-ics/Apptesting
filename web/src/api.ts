const BASE = "/api";

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

export interface TestCase {
  id: string;
  category: "smoke" | "boundary" | "vulnerability" | "stress";
  name: string;
  description: string;
  inputJson: string | null;
  result: TestResult | null;
  stressMetric?: StressMetric | null;
}

export interface TestRunDetail extends TestRun {
  testCases: TestCase[];
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
  runsOverTime: { date: string; runs: number; vulnerabilities: number }[];
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
  createTestRun: (data: { targetUrl: string; accountId?: string }) =>
    fetch(`${BASE}/test-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<TestRun>(r)),

  accountKpis: () => fetch(`${BASE}/kpi/accounts`).then((r) => json<AccountKpi[]>(r)),
  agentKpi: () => fetch(`${BASE}/kpi/agent`).then((r) => json<AgentPerformanceKpi>(r)),
};
