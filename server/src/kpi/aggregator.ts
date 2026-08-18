import { prisma } from "../db.js";
import { Prisma } from "../../generated/prisma/index.js";
import { TestCategory } from "../types.js";

export interface ModuleBreakdown {
  moduleName: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
}

export interface ProjectKpi {
  projectId: string | null; // null = "Unassigned" bucket (runs/accounts with no project set)
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

export async function computeProjectKpis(): Promise<ProjectKpiSummary> {
  const [projects, testRuns] = await Promise.all([
    prisma.project.findMany({ include: { modules: true }, orderBy: { createdAt: "asc" } }),
    prisma.testRun.findMany({
      include: { testCases: { include: { result: true, module: true } } },
    }),
  ]);

  function summarize(projectId: string | null, name: string, description: string | null, definedModules: ProjectKpi["definedModules"]): ProjectKpi {
    const runs = testRuns.filter((r) => r.projectId === projectId);
    const cases = runs.flatMap((r) => r.testCases);
    const withResult = cases.filter((c) => c.result);
    const passed = withResult.filter((c) => c.result!.status === "pass").length;
    const failed = withResult.filter((c) => c.result!.status === "fail").length;
    const errored = withResult.filter((c) => c.result!.status === "error").length;
    const vulns = withResult.filter((c) => c.category === "vulnerability" && c.result!.status === "fail").length;

    const byModule = new Map<string, ModuleBreakdown>();
    for (const c of cases) {
      const moduleName = c.module?.name ?? "Unmapped";
      const entry = byModule.get(moduleName) ?? { moduleName, totalCases: 0, passedCases: 0, failedCases: 0, errorCases: 0 };
      entry.totalCases += 1;
      if (c.result?.status === "pass") entry.passedCases += 1;
      else if (c.result?.status === "fail") entry.failedCases += 1;
      else if (c.result?.status === "error") entry.errorCases += 1;
      byModule.set(moduleName, entry);
    }

    const lastRun = runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];

    return {
      projectId,
      name,
      description,
      definedModules,
      totalRuns: runs.length,
      totalCases: cases.length,
      passedCases: passed,
      failedCases: failed,
      errorCases: errored,
      passRate: withResult.length ? passed / withResult.length : 0,
      vulnerabilitiesFound: vulns,
      moduleBreakdown: Array.from(byModule.values()).sort((a, b) => b.totalCases - a.totalCases),
      lastRunAt: lastRun ? lastRun.startedAt.toISOString() : null,
    };
  }

  const projectKpis = projects.map((p) =>
    summarize(
      p.id,
      p.name,
      p.description,
      p.modules.map((m) => ({ id: m.id, name: m.name, description: m.description }))
    )
  );

  const unassignedRuns = testRuns.filter((r) => !r.projectId);
  if (unassignedRuns.length) {
    projectKpis.push(summarize(null, "Unassigned", "Test runs not linked to a project", []));
  }

  const allCases = testRuns.flatMap((r) => r.testCases);
  const allWithResult = allCases.filter((c) => c.result);

  return {
    grandTotalRuns: testRuns.length,
    grandTotalCases: allCases.length,
    grandPassedCases: allWithResult.filter((c) => c.result!.status === "pass").length,
    grandFailedCases: allWithResult.filter((c) => c.result!.status === "fail").length,
    grandErrorCases: allWithResult.filter((c) => c.result!.status === "error").length,
    projects: projectKpis,
  };
}

export interface AccountKpi {
  accountId: string;
  label: string;
  role: string | null;
  totalRuns: number;
  totalCases: number;
  passRate: number; // 0-1
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

export async function computeAccountKpis(): Promise<AccountKpi[]> {
  const accounts = await prisma.account.findMany({
    include: {
      testRuns: {
        include: {
          testCases: { include: { result: true, stressMetric: true } },
          usageEvents: true,
        },
      },
    },
  });

  return accounts.map((acc) => {
    const allCases = acc.testRuns.flatMap((r) => r.testCases);
    const withResult = allCases.filter((c) => c.result);
    const passed = withResult.filter((c) => c.result!.status === "pass").length;
    const vulns = withResult.filter((c) => c.category === "vulnerability" && c.result!.status === "fail").length;

    const usageEvents = acc.testRuns.flatMap((r) => r.usageEvents).filter((e) => e.method !== "STRESS");
    const responseTimes = usageEvents.filter((e) => e.responseMs != null).map((e) => e.responseMs as number);
    const errorEvents = usageEvents.filter((e) => e.consoleError || (e.statusCode && e.statusCode >= 400));

    const stressMetrics = allCases.map((c) => c.stressMetric).filter((m): m is NonNullable<typeof m> => !!m);
    const accessibilityIssues = withResult.filter((c) => c.category === "accessibility" && c.result!.status === "fail").length;
    const performanceIssues = withResult.filter((c) => c.category === "performance" && c.result!.status === "fail").length;

    const lastRun = acc.testRuns.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];

    return {
      accountId: acc.id,
      label: acc.label,
      role: acc.role,
      totalRuns: acc.testRuns.length,
      totalCases: allCases.length,
      passRate: withResult.length ? passed / withResult.length : 0,
      vulnerabilitiesFound: vulns,
      avgResponseMs: responseTimes.length
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : null,
      errorEventCount: errorEvents.length,
      avgStressErrorRatePct: stressMetrics.length
        ? Math.round((stressMetrics.reduce((a, m) => a + m.errorRatePct, 0) / stressMetrics.length) * 10) / 10
        : null,
      avgStressP95LatencyMs: stressMetrics.length
        ? Math.round(stressMetrics.reduce((a, m) => a + m.p95LatencyMs, 0) / stressMetrics.length)
        : null,
      accessibilityIssuesFound: accessibilityIssues,
      performanceIssuesFound: performanceIssues,
      lastRunAt: lastRun ? lastRun.startedAt.toISOString() : null,
    };
  });
}

const ALL_CATEGORIES: TestCategory[] = [
  "smoke",
  "boundary",
  "vulnerability",
  "loginBoundary",
  "stress",
  "performance",
  "compatibility",
  "accessibility",
  "flow",
];

export interface CategoryIssueBreakdown {
  category: TestCategory;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  issues: number; // failedCases + errorCases
}

export interface DashboardTrendPoint {
  period: string; // groupBy "day": YYYY-MM-DD; "week": YYYY-MM-DD of that week's Monday
  runs: number;
  issues: number;
}

export interface DashboardFilterOptions {
  projects: { id: string; name: string }[];
  accounts: { id: string; label: string }[];
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
  filterOptions: DashboardFilterOptions;
}

export interface DashboardFilters {
  projectId?: string | null; // null = "Unassigned" bucket; undefined = all projects
  accountId?: string;
  from?: Date;
  to?: Date;
  groupBy?: "day" | "week";
}

// Monday of the ISO week containing `date`, as a YYYY-MM-DD string — used as
// both the sort key and the display label for weekly grouping.
function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDay = d.getUTCDay() || 7; // Mon=1 .. Sun=7
  d.setUTCDate(d.getUTCDate() - isoDay + 1);
  return d.toISOString().slice(0, 10);
}

export async function computeDashboardSummary(filters: DashboardFilters): Promise<DashboardSummary> {
  const where: Prisma.TestRunWhereInput = {};
  if (filters.projectId !== undefined) where.projectId = filters.projectId;
  if (filters.accountId) where.accountId = filters.accountId;
  if (filters.from || filters.to) {
    where.startedAt = {};
    if (filters.from) where.startedAt.gte = filters.from;
    if (filters.to) where.startedAt.lte = filters.to;
  }

  const [runs, projects, accounts] = await Promise.all([
    prisma.testRun.findMany({
      where,
      include: { testCases: { include: { result: true } } },
      orderBy: { startedAt: "asc" },
    }),
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.account.findMany({ select: { id: true, label: true }, orderBy: { label: "asc" } }),
  ]);

  const allCases = runs.flatMap((r) => r.testCases);
  const withResult = allCases.filter((c) => c.result);
  const passed = withResult.filter((c) => c.result!.status === "pass").length;
  const failed = withResult.filter((c) => c.result!.status === "fail").length;
  const errored = withResult.filter((c) => c.result!.status === "error").length;

  const issuesByCategory: CategoryIssueBreakdown[] = ALL_CATEGORIES.map((category) => {
    const cases = withResult.filter((c) => c.category === category);
    const f = cases.filter((c) => c.result!.status === "fail").length;
    const e = cases.filter((c) => c.result!.status === "error").length;
    return {
      category,
      totalCases: cases.length,
      passedCases: cases.filter((c) => c.result!.status === "pass").length,
      failedCases: f,
      errorCases: e,
      issues: f + e,
    };
  });

  const groupBy = filters.groupBy ?? "day";
  const byPeriod = new Map<string, { runIds: Set<string>; issues: number }>();
  for (const r of runs) {
    const period = groupBy === "week" ? weekKey(r.startedAt) : r.startedAt.toISOString().slice(0, 10);
    const entry = byPeriod.get(period) ?? { runIds: new Set(), issues: 0 };
    entry.runIds.add(r.id);
    entry.issues += r.testCases.filter((c) => c.result && c.result.status !== "pass").length;
    byPeriod.set(period, entry);
  }
  const trend = Array.from(byPeriod.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({ period, runs: v.runIds.size, issues: v.issues }));

  return {
    totalRuns: runs.length,
    totalCases: allCases.length,
    passedCases: passed,
    failedCases: failed,
    errorCases: errored,
    passRate: withResult.length ? passed / withResult.length : 0,
    totalIssues: failed + errored,
    issuesByCategory,
    trend,
    filterOptions: { projects, accounts },
  };
}

export async function computeAgentPerformanceKpi(): Promise<AgentPerformanceKpi> {
  const runs = await prisma.testRun.findMany({
    include: { testCases: { include: { result: true, stressMetric: true } } },
  });

  const completed = runs.filter((r) => r.status === "completed");
  const failed = runs.filter((r) => r.status === "failed");
  const durations = completed
    .filter((r) => r.completedAt)
    .map((r) => r.completedAt!.getTime() - r.startedAt.getTime());

  const vulnCases = runs.flatMap((r) => r.testCases).filter((c) => c.category === "vulnerability" && c.result?.status === "fail");
  const bySeverity: Record<string, number> = {};
  for (const c of vulnCases) {
    const sev = c.result?.severity ?? "unknown";
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }

  const byDate = new Map<string, { runs: number; vulnerabilities: number }>();
  for (const r of runs) {
    const date = r.startedAt.toISOString().slice(0, 10);
    const entry = byDate.get(date) ?? { runs: 0, vulnerabilities: 0 };
    entry.runs += 1;
    entry.vulnerabilities += r.testCases.filter((c) => c.category === "vulnerability" && c.result?.status === "fail").length;
    byDate.set(date, entry);
  }
  const runsOverTime = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  const allCases = runs.flatMap((r) => r.testCases);
  const stressMetrics = allCases.map((c) => c.stressMetric).filter((m): m is NonNullable<typeof m> => !!m);
  const accessibilityIssues = allCases.filter((c) => c.category === "accessibility" && c.result?.status === "fail").length;
  const performanceIssues = allCases.filter((c) => c.category === "performance" && c.result?.status === "fail").length;
  const flowCases = allCases.filter((c) => c.category === "flow" && c.result);
  const flowPassed = flowCases.filter((c) => c.result!.status === "pass").length;

  return {
    totalRuns: runs.length,
    completedRuns: completed.length,
    failedRuns: failed.length,
    avgRunDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    totalVulnerabilitiesFound: vulnCases.length,
    vulnerabilitiesBySeverity: bySeverity,
    totalStressTests: stressMetrics.length,
    avgStressErrorRatePct: stressMetrics.length
      ? Math.round((stressMetrics.reduce((a, m) => a + m.errorRatePct, 0) / stressMetrics.length) * 10) / 10
      : null,
    avgStressP95LatencyMs: stressMetrics.length
      ? Math.round(stressMetrics.reduce((a, m) => a + m.p95LatencyMs, 0) / stressMetrics.length)
      : null,
    totalAccessibilityIssues: accessibilityIssues,
    totalPerformanceIssues: performanceIssues,
    totalFlowRuns: flowCases.length,
    flowPassRate: flowCases.length ? flowPassed / flowCases.length : null,
    runsOverTime,
  };
}
