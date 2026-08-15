// Centralizes the Gemini model ID used by every AI generator, so a future
// Google deprecation (like gemini-2.5-flash being retired for new API
// keys) only needs a GEMINI_MODEL env var change instead of a code deploy.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
