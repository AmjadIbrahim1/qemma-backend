// backend/test-groq-arabic.js
// ✅ Groq integration test: generates 10 Arabic MCQs from arabic.txt via the Groq API.
//
// Calls generateForLanguage({ language: 'arabic', count: 10, ... }) directly — NO DB
// writes, NO contest row needed. Exercises the full pipeline: textbook load (UTF-8 .txt)
// → 3000-char chunking → random chunk selection → Arabic MCQ prompt → Groq (JSON mode)
// → validation → prints the questions + validates their structure.
//
// Requires: GROQ_API_KEY set in backend/.env + backend/data/textbooks/arabic.txt present.
//
// Run:  node test-groq-arabic.js

import 'dotenv/config';
import { generateForLanguage } from './src/modules/ai/contest-question-generator/generator.service.js';
import { GROQ_MODEL } from './src/modules/ai/_shared/groq.client.js';

const COUNT       = 10;
const DIFFICULTY  = 'Medium';
const POINT_VALUE = 2;

async function main() {
  let passed = 0, failed = 0;
  const errors = [];
  function check(label, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`; console.log(msg); errors.push(msg); }
  }

  console.log('🧪 Groq Integration Test: Arabic MCQ Generation\n');
  console.log(`  model: ${GROQ_MODEL} | count: ${COUNT} | difficulty: ${DIFFICULTY} | pointValue: ${POINT_VALUE}`);
  console.log(`  source: backend/data/textbooks/arabic.txt (UTF-8, 3000-char chunks, random selection)\n`);

  let questions;
  try {
    console.log('  → generating (this calls the live Groq API, may take ~30-60s)...');
    questions = await generateForLanguage({
      language:   'arabic',
      count:      COUNT,
      difficulty: DIFFICULTY,
      pointValue: POINT_VALUE,
    });
  } catch (err) {
    console.error(`\n❌ Generation failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`\n  Generated ${questions.length} question(s).\n`);

  // ── Print the generated questions ────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  questions.forEach((q, i) => {
    console.log(`\n  Q${i + 1}: ${q.text}`);
    q.options.forEach((opt, idx) => {
      const mark = idx === q.correctIndex ? ' ✅ (correct)' : '';
      console.log(`     ${String.fromCharCode(65 + idx)}) ${opt}${mark}`);
    });
    console.log(`     pointValue: ${q.pointValue}`);
  });
  console.log('\n═══════════════════════════════════════════════════════════\n');

  // ── Validate structure ───────────────────────────────────────────────
  check('Generated exactly 10 questions', questions.length === COUNT, `got ${questions.length}`);

  let textOk = 0, optsOk = 0, correctOk = 0, pointsOk = 0, arabicOk = 0;
  for (const q of questions) {
    if (typeof q.text === 'string' && q.text.trim()) textOk++;
    if (Array.isArray(q.options) && q.options.length === 4 && q.options.every((o) => typeof o === 'string' && o.trim())) optsOk++;
    if (Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3) correctOk++;
    if (Number.isInteger(q.pointValue) && q.pointValue >= 1) pointsOk++;
    // crude Arabic detection: contains Arabic Unicode block characters
    if (/[\u0600-\u06FF]/.test(q.text)) arabicOk++;
  }
  check('All 10 questions have non-empty text', textOk === COUNT, `${textOk}/${COUNT}`);
  check('All 10 questions have exactly 4 non-empty options', optsOk === COUNT, `${optsOk}/${COUNT}`);
  check('All 10 questions have a valid correctIndex (0-3)', correctOk === COUNT, `${correctOk}/${COUNT}`);
  check('All 10 questions have a valid pointValue (>=1)', pointsOk === COUNT, `${pointsOk}/${COUNT}`);
  check('All 10 questions are in Arabic (contain Arabic script)', arabicOk === COUNT, `${arabicOk}/${COUNT}`);

  // ── Dump JSON for the docs ───────────────────────────────────────────
  console.log('JSON_START');
  console.log(JSON.stringify(questions, null, 2));
  console.log('JSON_END');

  // ── Summary ──────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed > 0) { console.log(`  ${failed} FAILED:`); errors.forEach((e) => console.log(e)); process.exit(1); }
  else { console.log('  🎉 All tests passed!'); }
  process.exit(0);
}

main().catch((e) => { console.error('❌ Test error:', e); process.exit(1); });
