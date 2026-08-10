import { prisma } from "../db.js";

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
      lastRunAt: lastRun ? lastRun.startedAt.toISOString() : null,
    };
  });
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

  const stressMetrics = runs
    .flatMap((r) => r.testCases)
    .map((c) => c.stressMetric)
    .filter((m): m is NonNullable<typeof m> => !!m);

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
    runsOverTime,
  };
}
