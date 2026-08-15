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

// Retries a Gemini call once on a 429 (rate limit), waiting for the
// server-suggested delay first. Any other error, or a second 429, is
// rethrown for the caller's existing error handling.
export async function callGeminiWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if ((err as { status?: number })?.status !== 429) throw err;
    await new Promise((resolve) => setTimeout(resolve, extractRetryDelayMs(err, 20_000)));
    return fn();
  }
}
