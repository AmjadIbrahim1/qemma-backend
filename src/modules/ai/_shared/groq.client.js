// backend/src/modules/ai/_shared/groq.client.js
// ✅ NEW (AI contest question generation): thin wrapper over the Groq chat completions
// API (OpenAI-compatible) with JSON-mode output + exponential-backoff retry on rate
// limits. Keeps the generator service free of transport concerns.
//
// Uses the multi-key round‑robin client from config/groq.config.js to distribute TPD
// quota across all available GROQ_*_API_KEY values.

import { GROQ_MODEL, getGroqClient, getClientCount } from '../../../config/groq.config.js';

// ── Retry config ─────────────────────────────────────────────────────────────────
const MAX_RETRIES     = 4;   // total attempts = 1 + 3 retries
const BASE_DELAY_MS   = 1000;
const RATE_LIMIT_DELAY_MS = 60000; // 60s base delay when we hit a 429

// ── Public API: call Groq and parse a JSON object response ───────────────────────
// `system` + `user` are the chat messages. `temperature` defaults low for factual MCQs.
// Returns the parsed JSON object. Throws on non-JSON output after retries, or on
// non-retryable errors.
export async function generateJSON({ system, user, temperature = 0.4, maxTokens = 4000 }) {
  const client = getGroqClient();
  if (!client) {
    throw new Error('Groq client is not initialized (no GROQ_*_API_KEY set)');
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
      });

      const raw = completion?.choices?.[0]?.message?.content || '';
      const parsed = parseJSONObject(raw);
      if (parsed === null) {
        throw new Error('Groq returned non-JSON content (could not parse)');
      }
      return parsed;
    } catch (err) {
      lastErr = err;
      const retryable = isRetryable(err);
      if (!retryable || attempt === MAX_RETRIES) break;

      // Respect the suggested wait time from 429 errors when available
      let delay;
      if (err?.status === 429) {
        const suggested = parseRetryAfterFromError(err);
        delay = suggested !== null ? Math.min(suggested, 120_000) : RATE_LIMIT_DELAY_MS;
      } else {
        delay = BASE_DELAY_MS * Math.pow(2, attempt);
      }
      console.warn(`⚠️ groq.client: attempt ${attempt + 1} failed (${err.message}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

function parseJSONObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Some models wrap JSON in ```json fences even with json_object mode — try to recover.
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

function isRetryable(err) {
  // OpenAI SDK surfaces rate limits as 429; transient 5xx also retried.
  const status = err?.status || err?.response?.status;
  if (status === 429) return true;
  if (status && status >= 500 && status < 600) return true;
  // Network / timeout errors (no status) are also retryable.
  if (!status) return true;
  return false;
}

// Parse a human‑friendly "retry after" string like "1h7m24s" or "15m14s" from error messages.
// Returns milliseconds or null if parsing fails.
function parseRetryAfterFromError(err) {
  const msg = err?.message || err?.error?.message || '';
  // Match patterns like: "try again in 1h7m24s", "try again in 15m14s", "try again in 30s"
  const match = msg.match(/try\s+again\s+in\s+(\d+)(?:h(\d+))?(?:m(\d+(?:\.\d+)?))?s?/i);
  if (!match) return null;
  let ms = 0;
  if (match[1]) ms += parseInt(match[1], 10) * 3600_000;  // hours
  if (match[2]) ms += parseInt(match[2], 10) * 60_000;    // minutes
  if (match[3]) ms += parseFloat(match[3]) * 1000;         // seconds (may be fractional)
  return ms > 0 ? ms : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Health probe (used by tests) ─────────────────────────────────────────────────
export function isGroqAvailable() {
  return getClientCount() > 0;
}

export { GROQ_MODEL };
