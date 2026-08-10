import { prisma } from "../db.js";

export interface RegressionEntry {
  category: string;
  name: string;
  previousStatus: string;
  currentStatus: string;
}

export interface RegressionSummary {
  previousRunId: string | null;
  regressed: RegressionEntry[]; // was pass, now fail/error
  fixed: RegressionEntry[]; // was fail/error, now pass
}

// Compares a just-completed run against the most recent prior *completed*
// run for the same target (and account, if any) so repeat runs can surface
// what changed since last time — the core of regression testing.
export async function computeRegressions(testRunId: string): Promise<RegressionSummary> {
  const run = await prisma.testRun.findUniqueOrThrow({
    where: { id: testRunId },
    include: { testCases: { include: { result: true } } },
  });

  const previousRun = await prisma.testRun.findFirst({
    where: {
      targetUrl: run.targetUrl,
      accountId: run.accountId,
      status: "completed",
      id: { not: run.id },
      startedAt: { lt: run.startedAt },
    },
    orderBy: { startedAt: "desc" },
    include: { testCases: { include: { result: true } } },
  });

  if (!previousRun) {
    return { previousRunId: null, regressed: [], fixed: [] };
  }

  const previousByKey = new Map(previousRun.testCases.map((c) => [`${c.category}::${c.name}`, c]));

  const regressed: RegressionEntry[] = [];
  const fixed: RegressionEntry[] = [];

  for (const current of run.testCases) {
    const prev = previousByKey.get(`${current.category}::${current.name}`);
    if (!prev || !prev.result || !current.result) continue;

    const wasOk = prev.result.status === "pass";
    const isOk = current.result.status === "pass";

    if (wasOk && !isOk) {
      regressed.push({
        category: current.category,
        name: current.name,
        previousStatus: prev.result.status,
        currentStatus: current.result.status,
      });
    } else if (!wasOk && isOk) {
      fixed.push({
        category: current.category,
        name: current.name,
        previousStatus: prev.result.status,
        currentStatus: current.result.status,
      });
    }
  }

  return { previousRunId: previousRun.id, regressed, fixed };
}
