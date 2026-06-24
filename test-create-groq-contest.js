// backend/test-create-groq-contest.js
// ✅ Creates/updates a test contest (isTest=true) containing:
//   - 10 freshly generated Arabic questions (from the Arabic Groq test output)
//   - 10 previously generated English questions (parsed from docs/test_groq.md)
//
// Reuses: generateForLanguage is NOT called here — the Arabic questions come from
// re-running test-groq-arabic.js (captured in arabic_test_out.txt). The English
// questions are reused from docs/test_groq.md (no regeneration).
//
// Run:  node test-create-groq-contest.js
// (after running: node test-groq-arabic.js > arabic_test_out.txt)

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from './src/config/prisma.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TITLE = '[GROQ-TEST] Arabic + English MCQ Contest';

// ── 1. Extract Arabic questions from the test output ────────────────────────────
function loadArabicQuestions() {
  const outFile = path.join(__dirname, 'arabic_test_out.txt');
  const raw = fs.readFileSync(outFile, 'utf8');
  const match = raw.match(/JSON_START\r?\n([\s\S]*?)\r?\nJSON_END/);
  if (!match) throw new Error('Could not find JSON_START...JSON_END in arabic_test_out.txt');
  const questions = JSON.parse(match[1]);
  console.log(`📥 Loaded ${questions.length} Arabic questions from test output`);
  return questions;
}

// ── 2. Parse English questions from docs/test_groq.md ────────────────────────────
function loadEnglishQuestions() {
  const docPath = path.join(__dirname, '..', 'docs', 'test_groq.md');
  const md = fs.readFileSync(docPath, 'utf8');

  // Isolate the English section (between "### 5.2 English" and the next "---")
  const startIdx = md.indexOf('### 5.2 English');
  if (startIdx === -1) throw new Error('Could not find English questions section in docs/test_groq.md');
  const endIdx = md.indexOf('\n---\n', startIdx);
  const section = md.slice(startIdx, endIdx === -1 ? undefined : endIdx);

  // Parse each question block: **Q{N}.** {text} followed by option lines + pointValue
  const questions = [];
  const blockRegex = /\*\*Q(\d+)\.\*\*\s+(.+?)\n((?:\s+-\s+[A-D]\).*?\n)+)\s+-\s+pointValue:\s*(\d+)/g;
  let m;
  while ((m = blockRegex.exec(section)) !== null) {
    const text = m[2].trim();
    const optionLines = m[3].split('\n').map((l) => l.trim()).filter(Boolean);
    const options = [];
    let correctIndex = -1;
    for (const line of optionLines) {
      const optMatch = line.match(/^-\s+([A-D])\)\s+(.+?)(?:\s*\*\(correct\)\*)?$/);
      if (optMatch) {
        const letter = optMatch[1];
        const optText = optMatch[2].trim();
        const idx = letter.charCodeAt(0) - 65;
        options.push(optText);
        if (line.includes('*(correct)*')) correctIndex = idx;
      }
    }
    const pointValue = parseInt(m[4], 10);
    if (options.length === 4 && correctIndex >= 0) {
      questions.push({ text, options, correctIndex, pointValue });
    }
  }
  console.log(`📥 Loaded ${questions.length} English questions from docs/test_groq.md`);
  return questions;
}

// ── 3. Insert questions transactionally (mirrors generator.service.js) ──────────
async function insertQuestions(contestId, questions) {
  let inserted = 0;
  for (const q of questions) {
    await prisma.$transaction(async (tx) => {
      const newQ = await tx.contestQuestion.create({
        data: { contestId, text: q.text, pointValue: q.pointValue, aiGenerated: true },
      });
      await tx.contestOption.createMany({
        data: q.options.map((text, idx) => ({
          contestQuestionId: newQ.id,
          text,
          isCorrect: idx === q.correctIndex,
        })),
      });
    });
    inserted++;
  }
  return inserted;
}

// ── Main ────────────────────────────────────────────────────────────────────────
async function main() {
  let passed = 0, failed = 0;
  const errors = [];
  function check(label, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`; console.log(msg); errors.push(msg); }
  }

  console.log('🧪 Test: Create Groq Test Contest\n');

  // Load questions
  const arabicQuestions  = loadArabicQuestions();
  const englishQuestions = loadEnglishQuestions();
  const allQuestions     = [...arabicQuestions, ...englishQuestions];

  console.log(`  Total: ${allQuestions.length} questions (${arabicQuestions.length} Arabic + ${englishQuestions.length} English)\n`);

  // Find or create the test contest
  let contest = await prisma.contest.findFirst({ where: { title: TITLE } });

  if (contest) {
    // Update: wipe existing questions first (cascade deletes options + answers)
    await prisma.contestQuestion.deleteMany({ where: { contestId: contest.id } });
    await prisma.contest.update({ where: { id: contest.id }, data: { questionCount: 0, aiGenerationStatus: null, aiGeneratedAt: null } });
    console.log(`  ♻️  Reusing existing test contest "${TITLE}" (${contest.id.slice(0, 8)}) — cleared old questions`);
  } else {
    contest = await prisma.contest.create({
      data: {
        title:      TITLE,
        stream:     'Literary',
        difficulty: 'Medium',
        duration:   60,
        startTime:  new Date(),
        isTest:     true,
      },
    });
    console.log(`  ✨ Created new test contest "${TITLE}" (${contest.id.slice(0, 8)})`);
  }

  // Insert all questions
  console.log('\n  → inserting questions...');
  const insertedArabic  = await insertQuestions(contest.id, arabicQuestions);
  const insertedEnglish = await insertQuestions(contest.id, englishQuestions);
  const totalInserted   = insertedArabic + insertedEnglish;

  // Update denormalized questionCount
  await prisma.contest.update({
    where: { id: contest.id },
    data:  { questionCount: totalInserted, aiGenerationStatus: 'completed', aiGeneratedAt: new Date() },
  });

  console.log(`  Inserted: ${insertedArabic} Arabic + ${insertedEnglish} English = ${totalInserted} total\n`);

  // ── Verify ────────────────────────────────────────────────────────────────────
  const dbQuestions = await prisma.contestQuestion.findMany({
    where:   { contestId: contest.id },
    include: { options: true },
    orderBy: { createdAt: 'asc' },
  });
  const dbContest = await prisma.contest.findUnique({ where: { id: contest.id } });

  check('Contest exists in DB', !!dbContest);
  check('Contest isTest = true', dbContest?.isTest === true);
  check(`Contest has ${allQuestions.length} questions`, dbQuestions.length === allQuestions.length, `got ${dbQuestions.length}`);
  check('Contest questionCount matches', dbContest?.questionCount === totalInserted, `got ${dbContest?.questionCount}`);

  // Verify each question has 4 options with exactly 1 correct
  let structOk = 0;
  let arabicCount = 0;
  let englishCount = 0;
  for (const q of dbQuestions) {
    if (q.options.length === 4 && q.options.filter((o) => o.isCorrect).length === 1) structOk++;
    if (/[\u0600-\u06FF]/.test(q.text)) arabicCount++;
    else englishCount++;
  }
  check('All questions have 4 options with exactly 1 correct', structOk === allQuestions.length, `${structOk}/${allQuestions.length}`);
  check(`Arabic questions in DB = ${arabicQuestions.length}`, arabicCount === arabicQuestions.length, `got ${arabicCount}`);
  check(`English questions in DB = ${englishQuestions.length}`, englishCount === englishQuestions.length, `got ${englishCount}`);
  check('All questions are aiGenerated = true', dbQuestions.every((q) => q.aiGenerated === true));

  // ── Summary ───────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Contest:  "${TITLE}" (id: ${contest.id.slice(0, 8)}, isTest: true)`);
  console.log(`  Arabic:   ${arabicCount} questions`);
  console.log(`  English:  ${englishCount} questions`);
  console.log(`  Total:    ${dbQuestions.length} questions`);
  console.log(`  Results:  ${passed}/${total} passed`);
  if (failed > 0) { console.log(`  ${failed} FAILED:`); errors.forEach((e) => console.log(e)); process.exit(1); }
  else { console.log('  🎉 All tests passed!'); }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error('❌ Test error:', e); process.exit(1); });
