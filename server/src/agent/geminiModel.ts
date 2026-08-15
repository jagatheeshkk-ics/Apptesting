// Centralizes the Gemini model ID used by every AI generator, so a future
// Google deprecation (like gemini-2.5-flash being retired for new API
// keys) only needs a GEMINI_MODEL env var change instead of a code deploy.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

// Google's free tier is a very low requests-per-minute quota (e.g. 5/min).
// A 429 response includes a human-readable "Please retry in Ns" hint —
// honor it (with a small buffer) instead of giving up immediately, since
// callers here are one-off per-module/per-run calls, not a hot loop.
function extractRetryDelayMs(err: unknown, fallbackMs: number): number {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/retry in ([\d.]+)s/i);
  if (!match) return fallbackMs;
  const seconds = parseFloat(match[1]);
  return Number.isNaN(seconds) ? fallbackMs : Math.min(Math.ceil(seconds * 1000) + 1000, 60_000);
}

// 429 = rate limited (quota); 503 = Google's own "model is experiencing
// high demand, usually temporary" overload signal. Both are worth retrying;
// anything else (bad key, bad model, malformed request) won't be fixed by
// waiting, so it's rethrown immediately.
const RETRYABLE_STATUSES = new Set([429, 503]);

// Google's free tier has both a per-minute quota (recovers within
// seconds — worth retrying) and a per-day quota (e.g. 20 requests/day/model
// — won't recover for hours). The 429 error body's quotaId names which one
// tripped; a per-day quota is pointless to retry since the same call will
// fail again immediately, just wasting the backoff delay.
export function isGeminiDailyQuotaExhausted(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /perday/i.test(message);
}

// Retries a Gemini call up to twice on a 429/503, waiting for the
// server-suggested delay on a 429 or a short fixed backoff on a 503 — but
// never retries a 429 caused by an exhausted per-day quota, since that
// won't clear within any reasonable backoff window. Any other error, or a
// retryable error on the final attempt, is rethrown for the caller's
// existing error handling.
export async function callGeminiWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const retryable = RETRYABLE_STATUSES.has(status as number) && !(status === 429 && isGeminiDailyQuotaExhausted(err));
      if (!retryable || attempt >= maxRetries) throw err;
      const delayMs = status === 429 ? extractRetryDelayMs(err, 20_000) : 3_000 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
