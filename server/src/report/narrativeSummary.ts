import { RegressionSummary } from "../analysis/regression.js";
import { TEST_CATEGORY_LABELS } from "../types.js";

export interface NarrativeTestCase {
  category: string;
  name: string;
  result: { status: string; severity: string | null } | null;
}

export interface NarrativeRunInfo {
  targetUrl: string;
  moduleName: string | null;
  mode: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
}

// Lowercases just the first letter (not the whole label) so labels with an
// embedded acronym — "Login boundary (BVA)" — read naturally mid-sentence
// ("...found in login boundary (BVA)...") instead of "(bva)".
function categoryLabel(category: string): string {
  const label = (TEST_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

// "SQL injection #1, reflected XSS #2, and 3 more" — up to two named
// examples, then a count of the rest, so the summary stays a sentence
// rather than a dump of every failing case name.
function listCases(names: string[]): string {
  const shown = names.slice(0, 2).join(", ");
  const rest = names.length - 2;
  if (rest <= 0) return shown;
  return `${shown}, and ${rest} more`;
}

export function buildNarrativeSummary(
  run: NarrativeRunInfo,
  testCases: NarrativeTestCase[],
  regressions: RegressionSummary | null,
): string {
  const sentences: string[] = [];

  const subject = run.moduleName ? `the "${run.moduleName}" module` : "the application";
  const modePrefix = run.mode === "quick" ? "A quick/sanity" : "A full";
  sentences.push(
    `${modePrefix} test run checked ${subject} at ${run.targetUrl}, executing ${run.totalCases} test case${run.totalCases === 1 ? "" : "s"}.`,
  );

  if (run.totalCases === 0) {
    sentences.push("No test cases were generated for this run — check that the target page rendered fields the agent could recognize.");
    return sentences.join(" ");
  }

  const issues = run.failedCases + run.errorCases;
  if (issues === 0) {
    sentences.push(`All ${run.passedCases} case${run.passedCases === 1 ? "" : "s"} passed — no failures or errors were found.`);
  } else {
    const passRate = Math.round((run.passedCases / run.totalCases) * 100);
    sentences.push(
      `${run.passedCases} passed, ${run.failedCases} failed, and ${run.errorCases} could not be completed (${passRate}% pass rate).`,
    );
  }

  // Break failures/errors down by category so the reader knows *where* the
  // problems are, not just how many — mentioning a couple of case names per
  // category so it's actionable without becoming a full case listing.
  const byCategory = new Map<string, string[]>();
  for (const tc of testCases) {
    if (!tc.result || tc.result.status === "pass") continue;
    const list = byCategory.get(tc.category) ?? [];
    list.push(tc.name);
    byCategory.set(tc.category, list);
  }
  if (byCategory.size) {
    const clauses = Array.from(byCategory.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([category, names]) => `${names.length} in ${categoryLabel(category)} (${listCases(names)})`);
    sentences.push(`Issues were found across ${byCategory.size} area${byCategory.size === 1 ? "" : "s"}: ${clauses.join("; ")}.`);
  }

  const criticalOrHigh = testCases.filter(
    (tc) => tc.category === "vulnerability" && tc.result?.status === "fail" && (tc.result.severity === "critical" || tc.result.severity === "high"),
  );
  if (criticalOrHigh.length) {
    sentences.push(
      `${criticalOrHigh.length} of the security finding${criticalOrHigh.length === 1 ? " is" : "s are"} high or critical severity and should be prioritized.`,
    );
  }

  if (regressions?.previousRunId) {
    if (regressions.regressed.length) {
      sentences.push(
        `Compared to the previous run, ${regressions.regressed.length} case${regressions.regressed.length === 1 ? "" : "s"} that used to pass ${regressions.regressed.length === 1 ? "is" : "are"} now failing (${listCases(regressions.regressed.map((r) => r.name))}).`,
      );
    }
    if (regressions.fixed.length) {
      sentences.push(
        `${regressions.fixed.length} previously-failing case${regressions.fixed.length === 1 ? "" : "s"} now pass${regressions.fixed.length === 1 ? "es" : ""} (${listCases(regressions.fixed.map((r) => r.name))}).`,
      );
    }
  }

  return sentences.join(" ");
}
