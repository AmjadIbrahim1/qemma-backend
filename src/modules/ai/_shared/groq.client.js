// backend/src/modules/ai/_shared/groq.client.js
// ✅ NEW (AI contest question generation): thin wrapper over the Groq chat completions
// API (OpenAI-compatible) with JSON-mode output + exponential-backoff retry on rate
// limits. Keeps the generator service free of transport concerns.
//
// The actual client singleton lives in config/groq.config.js (env-driven, mirrors
// clerk.config.js). This module exports the higher-level `generateJSON()` call.

import groqClient, { GROQ_MODEL } from '../../../config/groq.config.js';

// ── Retry config ─────────────────────────────────────────────────────────────────
const MAX_RETRIES   = 4;   // total attempts = 1 + 3 retries
const BASE_DELAY_MS = 1000; // 1s → 2s → 4s → 8s

// ── Public API: call Groq and parse a JSON object response ───────────────────────
// `system` + `user` are the chat messages. `temperature` defaults low for factual MCQs.
// Returns the parsed JSON object. Throws on non-JSON output after retries, or on
// non-retryable errors.
export async function generateJSON({ system, user, temperature = 0.4, maxTokens = 4000 }) {
  if (!groqClient) {
    throw new Error('Groq client is not initialized (GROQ_API_KEY missing)');
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await groqClient.chat.completions.create({
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
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Health probe (used by tests) ─────────────────────────────────────────────────
export function isGroqAvailable() {
  return !!groqClient;
}

export { GROQ_MODEL };
