// backend/test-groq-english.js
// ✅ Groq integration test: generates 10 English MCQs from english.pdf via the Groq API.
//
// Calls generateForLanguage({ language: 'english', count: 10, ... }) directly — NO DB
// writes, NO contest row needed. Exercises the full pipeline: textbook load (pdfjs-dist
// .pdf) → 3000-char chunking → random chunk selection → English MCQ prompt → Groq
// (JSON mode) → validation → prints the questions + validates their structure.
//
// Requires: GROQ_API_KEY set in backend/.env + backend/data/textbooks/english.pdf present.
//
// Run:  node test-groq-english.js

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

  console.log('🧪 Groq Integration Test: English MCQ Generation\n');
  console.log(`  model: ${GROQ_MODEL} | count: ${COUNT} | difficulty: ${DIFFICULTY} | pointValue: ${POINT_VALUE}`);
  console.log(`  source: backend/data/textbooks/english.pdf (pdfjs-dist, 3000-char chunks, random selection)\n`);

  let questions;
  try {
    console.log('  → generating (this calls the live Groq API, may take ~30-60s)...');
    questions = await generateForLanguage({
      language:   'english',
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

  let textOk = 0, optsOk = 0, correctOk = 0, pointsOk = 0, englishOk = 0;
  for (const q of questions) {
    if (typeof q.text === 'string' && q.text.trim()) textOk++;
    if (Array.isArray(q.options) && q.options.length === 4 && q.options.every((o) => typeof o === 'string' && o.trim())) optsOk++;
    if (Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3) correctOk++;
    if (Number.isInteger(q.pointValue) && q.pointValue >= 1) pointsOk++;
    // crude English detection: mostly Latin script, negligible Arabic
    const arabicChars = (q.text.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicChars === 0) englishOk++;
  }
  check('All 10 questions have non-empty text', textOk === COUNT, `${textOk}/${COUNT}`);
  check('All 10 questions have exactly 4 non-empty options', optsOk === COUNT, `${optsOk}/${COUNT}`);
  check('All 10 questions have a valid correctIndex (0-3)', correctOk === COUNT, `${correctOk}/${COUNT}`);
  check('All 10 questions have a valid pointValue (>=1)', pointsOk === COUNT, `${pointsOk}/${COUNT}`);
  check('All 10 questions are in English (no Arabic script)', englishOk === COUNT, `${englishOk}/${COUNT}`);

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
