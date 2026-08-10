import { DetectedModule, ExecutedResult } from "../types.js";
import { defaultValueFor } from "./executor.js";
import { STRESS_CONCURRENCY } from "./testGenerators/stress.js";

const TIMEOUT_MS = 10000;

export interface RequestOutcome {
  ok: boolean;
  status: number;
  ms: number;
  error?: string;
}

export interface StressMetrics {
  concurrency: number;
  totalRequests: number;
  errorCount: number;
  errorRatePct: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export interface StressExecutionResult {
  result: ExecutedResult;
  metrics: StressMetrics;
}

async function timedFetch(url: string, init: RequestInit): Promise<RequestOutcome> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
    // 3xx redirects are a normal outcome for form POSTs in this app and are not errors;
    // only 5xx (server failure) or network-level failures count against the app here.
    return { ok: res.status < 500, status: res.status, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - start, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

function percentile(sortedAscending: number[], p: number): number {
  if (!sortedAscending.length) return 0;
  const idx = Math.min(sortedAscending.length - 1, Math.floor((p / 100) * sortedAscending.length));
  return sortedAscending[idx];
}

function buildFormBody(module: DetectedModule): string {
  const params = new URLSearchParams();
  for (const field of module.fields) {
    if (field.type === "checkbox" || field.type === "radio" || field.type === "select") continue;
    params.set(field.name, defaultValueFor(field));
  }
  return params.toString();
}

export async function executeStressCase(
  testCaseName: string,
  module: DetectedModule,
  onRequest?: (outcome: RequestOutcome) => void,
): Promise<StressExecutionResult> {
  const start = Date.now();
  const isFormCase = testCaseName.startsWith("Repeated submission load");

  const tasks = Array.from({ length: STRESS_CONCURRENCY }, () =>
    isFormCase
      ? timedFetch(module.url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: buildFormBody(module),
        })
      : timedFetch(module.url, { method: "GET" }),
  );

  const outcomes = await Promise.all(tasks);
  outcomes.forEach((o) => onRequest?.(o));

  const latencies = outcomes.map((o) => o.ms).sort((a, b) => a - b);
  const errors = outcomes.filter((o) => !o.ok);
  const errorRatePct = Math.round((errors.length / outcomes.length) * 1000) / 10;
  const avgLatencyMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const p95LatencyMs = percentile(latencies, 95);

  let status: ExecutedResult["status"] = "pass";
  let severity: ExecutedResult["severity"] = "info";
  if (errorRatePct > 30) {
    status = "fail";
    severity = "critical";
  } else if (errorRatePct > 10) {
    status = "fail";
    severity = "high";
  } else if (p95LatencyMs > 5000) {
    status = "fail";
    severity = "medium";
  }

  const sample = errors[0];
  const actual =
    `${STRESS_CONCURRENCY} concurrent requests: ${errorRatePct}% error rate, ` +
    `avg ${avgLatencyMs}ms, p95 ${p95LatencyMs}ms.` +
    (errors.length
      ? ` ${errors.length} request(s) failed (e.g. ${sample.error ?? `HTTP ${sample.status}`}).`
      : "");

  return {
    result: { status, severity, actual, durationMs: Date.now() - start },
    metrics: {
      concurrency: STRESS_CONCURRENCY,
      totalRequests: outcomes.length,
      errorCount: errors.length,
      errorRatePct,
      avgLatencyMs,
      p95LatencyMs,
    },
  };
}
