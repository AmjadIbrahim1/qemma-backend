// backend/src/modules/ai/contest-question-generator/generator.service.js
// ✅ Uses GROQ_API_KEY (via the shared groq.client) for ALL Golden Contests,
// including test-based contests. Target: 50 questions per contest.
//
// Given a contest that is missing questions, this service:
//   1. Computes the gap = 50 − currentRealCount (all contests target exactly 50 questions)
//   2. Splits it ~50/50 into Arabic + English questions (Arabic gets the extra if odd)
//   3. For each language: loads the cached textbook chunks → calls Groq via the shared
//      groq client (GROQ_API_KEY) in batches of BATCH_SIZE → validates each MCQ →
//      retries a batch up to MAX_BATCH_ATTEMPTS if short/invalid → inserts the valid
//      questions transactionally (mirrors the addContestQuestion pattern:
//      ContestQuestion + ContestOption[]) and marks aiGenerated=true.
//   4. Updates the contest's aiGenerationStatus + aiGeneratedAt + questionCount.
//
// Default pointValue per AI question: Easy=1, Medium=2, Hard=4 (consistent with teacher-added
// questions and scoring which sums pointValue for correct answers).

import prisma from '../../../config/prisma.config.js';
import { loadTextbook, pickChunk } from '../../ai/_shared/pdf-parser.js';
import { generateJSON, isGroqAvailable } from '../../ai/_shared/groq.client.js';
import { buildArabicPrompt, buildEnglishPrompt } from './prompts/mcq.prompt.js';

// ── Config ───────────────────────────────────────────────────────────────────────
const REQUIRED_QUESTIONS = { Easy: 50, Medium: 50, Hard: 50 };
const DEFAULT_POINT_VALUE = { Easy: 1, Medium: 2, Hard: 4 };
const BATCH_SIZE          = 3;   // questions per Groq call (reduced from 5 to stay under Groq free-tier 6000 TPM limit)
const MAX_BATCH_ATTEMPTS  = 3;   // retries per batch when output is short/invalid

const TEXTBOOK_FILE = { arabic: 'arabic.pdf', english: 'english.pdf' };

// ── Validation (mirrors contests.service.js addContestQuestion rules) ────────────
function validateRawQuestion(q, expectedPointValue) {
  if (!q || typeof q !== 'object') return null;
  const text = typeof q.text === 'string' ? q.text.trim() : '';
  if (!text) return null;

  const options = Array.isArray(q.options) ? q.options : [];
  if (options.length !== 4) return null;
  const cleanOptions = options.map((o) => (typeof o === 'string' ? o.trim() : ''));
  if (cleanOptions.some((o) => !o)) return null;

  const correctIndex = Number(q.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) return null;

  const pointValue = Number.isInteger(q.pointValue) && q.pointValue >= 1
    ? q.pointValue
    : expectedPointValue;

  return { text, options: cleanOptions, correctIndex, pointValue };
}

// ── Generate N questions for one language (batched, with retry) ──────────────────
// Exported so the Groq integration tests (test-groq-arabic.js / test-groq-english.js)
// can call it directly without going through a DB contest.
export async function generateForLanguage({ language, count, difficulty, pointValue }) {
  if (count <= 0) return [];

  const { chunks } = await loadTextbook(TEXTBOOK_FILE[language]);
  if (chunks.length === 0) {
    throw new Error(`No text extracted from ${TEXTBOOK_FILE[language]}`);
  }

  // ✅ NEW: for English generation, exclude chunks that contain Arabic script. The English
  // textbook includes Arabic Ministry of Education headers (e.g. "تهدي وزارة التربية
  // والتعليم") which cause the Groq model to mix Arabic into English output (e.g. "2 درجة"
  // instead of "2 points"). Filtering these chunks out at the source ensures only
  // English-language context reaches the model.
  const usableChunks = language === 'english'
    ? chunks.filter((c) => !/[\u0600-\u06FF]/.test(c))
    : chunks;
  if (usableChunks.length === 0) {
    throw new Error(`No ${language}-appropriate chunks found in ${TEXTBOOK_FILE[language]}`);
  }

  const builder = language === 'arabic' ? buildArabicPrompt : buildEnglishPrompt;
  const collected = [];
  let produced  = 0;

  while (produced < count) {
    const want = Math.min(BATCH_SIZE, count - produced);
    let batch = null;

    for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt++) {
      // ✅ Select a RANDOM chunk per batch so questions draw from varied parts of the book.
      const context = pickChunk(usableChunks);
      const { system, user } = builder({ context, count: want, difficulty, pointValue });

      let parsed;
      try {
        parsed = await generateJSON({ system, user, temperature: 0.5, maxTokens: 2000 });
      } catch (err) {
        console.warn(`⚠️ generator: ${language} batch attempt ${attempt} failed: ${err.message}`);
        if (attempt === MAX_BATCH_ATTEMPTS) throw err;
        continue;
      }

      const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
      const valid = rawQuestions
        .map((q) => validateRawQuestion(q, pointValue))
        .filter(Boolean)
        .slice(0, want);

      if (valid.length > 0) {
        batch = valid;
        break;
      }
      if (attempt === MAX_BATCH_ATTEMPTS) {
        throw new Error(`Groq produced no valid ${language} questions after ${MAX_BATCH_ATTEMPTS} attempts`);
      }
    }

    for (const q of batch) collected.push(q);
    produced += batch.length;
  }

  return collected.slice(0, count);
}

// ── Insert questions transactionally (mirrors addContestQuestion) ────────────────
async function insertQuestions(contestId, questions) {
  let inserted = 0;
  for (const q of questions) {
    await prisma.$transaction(async (tx) => {
      const newQ = await tx.contestQuestion.create({
        data: {
          contestId,
          text:       q.text,
          pointValue: q.pointValue,
          aiGenerated: true,
        },
      });
      await tx.contestOption.createMany({
        data: q.options.map((text, idx) => ({
          contestQuestionId: newQ.id,
          text,
          isCorrect:         idx === q.correctIndex,
        })),
      });
    });
    inserted++;
  }
  return inserted;
}

// ── Public entry: generate + persist the missing questions for a contest ────────
// `contest` must include { id, difficulty }. Caller is responsible for the trigger
// window + idempotency guards (see contestQuestionGenerator.job.js).
//
// Returns { required, current, gap, generated, inserted, skipped, status }.
export async function generateForContest(contest) {
  // All contests (including test contests) target exactly 50 questions.
  const required = 50;

  // Use the REAL question count (the denormalized questionCount field can drift).
  const current = await prisma.contestQuestion.count({ where: { contestId: contest.id } });
  const gap = required - current;
  if (gap <= 0) {
    // Already has 50+ questions — mark once so we don't re-evaluate every tick.
    await prisma.contest.update({
      where: { id: contest.id },
      data:  { aiGenerationStatus: 'not_needed', aiGeneratedAt: new Date() },
    });
    return { required, current, gap: 0, generated: 0, inserted: 0, status: 'not_needed' };
  }

  if (!isGroqAvailable()) {
    throw new Error('Groq client is not available (GROQ_API_KEY not set) — cannot generate questions');
  }

  // 50/50 split — Arabic gets the extra question when the gap is odd.
  const arabicN  = Math.ceil(gap / 2);
  const englishN = Math.floor(gap / 2);
  const pointValue = DEFAULT_POINT_VALUE[contest.difficulty];

  console.log(`🤖 generator: "${contest.title}" needs ${gap} (Arabic=${arabicN}, English=${englishN})`);

  // Mark in-progress so a parallel run / restart sees 'pending'.
  await prisma.contest.update({
    where: { id: contest.id },
    data:  { aiGenerationStatus: 'pending' },
  });

  try {
    const [arabicQs, englishQs] = await Promise.all([
      generateForLanguage({ language: 'arabic',  count: arabicN,  difficulty: contest.difficulty, pointValue }),
      generateForLanguage({ language: 'english', count: englishN, difficulty: contest.difficulty, pointValue }),
    ]);

    const all = [...arabicQs, ...englishQs];
    const inserted = await insertQuestions(contest.id, all);

    // Keep the denormalized questionCount in sync (mirrors addContestQuestion increment).
    if (inserted > 0) {
      await prisma.contest.update({
        where: { id: contest.id },
        data:  { questionCount: { increment: inserted } },
      });
    }

    const finalStatus = inserted >= gap ? 'completed' : 'partial';
    await prisma.contest.update({
      where: { id: contest.id },
      data:  { aiGenerationStatus: finalStatus, aiGeneratedAt: new Date() },
    });

    console.log(`✅ generator: "${contest.title}" inserted ${inserted}/${gap} (status=${finalStatus})`);
    return {
      required,
      current,
      gap,
      generated: all.length,
      inserted,
      status: finalStatus,
    };
  } catch (err) {
    // Mark failed so the job stops retrying this contest every minute (operator can reset).
    await prisma.contest.update({
      where: { id: contest.id },
      data:  { aiGenerationStatus: 'failed', aiGeneratedAt: new Date() },
    });
    throw err;
  }
}

// ── Exports for tests/config ─────────────────────────────────────────────────────
export { REQUIRED_QUESTIONS, DEFAULT_POINT_VALUE };
