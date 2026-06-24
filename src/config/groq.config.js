// backend/src/config/groq.config.js
// ✅ NEW (AI contest question generation): Groq API client singleton.
//
// Groq exposes an OpenAI-compatible Chat Completions API, so we reuse the already-installed
// `openai` SDK (v4) pointed at Groq's baseURL — no new HTTP dependency. Mirrors the
// clerk.config.js singleton pattern.
//
// Env (backend/.env):
//   GROQ_API_KEY   — required; the Groq API key
//   GROQ_MODEL     — optional; defaults to 'llama-3.3-70b-versatile' (strong Arabic + JSON)
//   GROQ_BASE_URL  — optional; defaults to 'https://api.groq.com/openai/v1'

import OpenAI from 'openai';

const GROQ_API_KEY  = process.env.GROQ_API_KEY || '';
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
export const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Lazily build the client only when first imported by a consumer that actually needs it.
// If GROQ_API_KEY is missing we still export a stub flag so callers can degrade gracefully
// (e.g. skip generation and log) instead of crashing boot.
let groqClient = null;

if (!GROQ_API_KEY) {
  console.warn('⚠️ groq.config: GROQ_API_KEY is not set — AI contest question generation will be disabled.');
} else {
  groqClient = new OpenAI({
    apiKey: GROQ_API_KEY,
    baseURL: GROQ_BASE_URL,
  });
  console.log('✅ Groq client initialized (baseURL:', GROQ_BASE_URL + ', model:', GROQ_MODEL + ')');
}

export { groqClient };
export default groqClient;
