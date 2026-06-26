// backend/src/config/groq.config.js
// ✅ NEW (AI contest question generation): Groq API client singleton with multi-key rotation.
//
// Groq exposes an OpenAI-compatible Chat Completions API, so we reuse the already-installed
// `openai` SDK (v4) pointed at Groq's baseURL — no new HTTP dependency. Mirrors the
// clerk.config.js singleton pattern.
//
// Env (backend/.env):
//   GROQ_API_KEY               — primary key
//   GROQ_EXAM_API_KEY          — additional role keys (rotated round-robin to
//   GROQ_STUDENT_API_KEY       — distribute TPD quota across multiple keys)
//   GROQ_TEACHER_API_KEY
//   GROQ_TEACHER_ANALSYS_API_KEY
//   GROQ_STUDENT_ANALSYS_API_KEY
//   GROQ_MODEL                 — optional; defaults to 'llama-3.3-70b-versatile'
//   GROQ_BASE_URL              — optional; defaults to 'https://api.groq.com/openai/v1'

import OpenAI from 'openai';

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
export const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Collect every GROQ_*_API_KEY from the environment, deduplicate, and build a client per key.
// This spreads the TPD (tokens-per-day) quota across all available keys.
const GROQ_KEY_ENV_VARS = [
  'GROQ_API_KEY',
  'GROQ_EXAM_API_KEY',
  'GROQ_STUDENT_API_KEY',
  'GROQ_TEACHER_API_KEY',
  'GROQ_TEACHER_ANALSYS_API_KEY',
  'GROQ_STUDENT_ANALSYS_API_KEY',
];

const _clients = [];
for (const envKey of GROQ_KEY_ENV_VARS) {
  const key = (process.env[envKey] || '').trim();
  if (key) {
    _clients.push(new OpenAI({ apiKey: key, baseURL: GROQ_BASE_URL }));
  }
}

// Round‑robin index
let _rrIndex = 0;

export function getGroqClient() {
  if (_clients.length === 0) return null;
  const client = _clients[_rrIndex % _clients.length];
  _rrIndex++;
  return client;
}

export function getClientCount() {
  return _clients.length;
}

if (_clients.length === 0) {
  console.warn('⚠️ groq.config: no GROQ_*_API_KEY set — AI contest question generation will be disabled.');
} else {
  console.log(`✅ Groq client initialized (${_clients.length} key(s), baseURL: ${GROQ_BASE_URL}, model: ${GROQ_MODEL})`);
}

export { _clients as groqClients };
