// backend/src/modules/ai/contest-question-generator/prompts/mcq.prompt.js
// ✅ NEW (AI contest question generation): Arabic + English MCQ prompt builders.
//
// Each builder returns { system, user } strings for the Groq chat API (JSON mode). The
// generator service passes a textbook chunk as context and asks for `count` MCQs in a
// strict JSON schema so the parser/validator can consume them directly.
//
// Output JSON contract (shared by both languages):
//   {
//     "questions": [
//       {
//         "text": "<question stem>",
//         "options": ["opt1","opt2","opt3","opt4"],   // exactly 4
//         "correctIndex": 0..3,                        // exactly one correct
//         "pointValue": <int>                          // teacher-equivalent weight
//       }
//     ]
//   }

const DIFFICULTY_LABEL_AR = { Easy: 'سهل', Medium: 'متوسط', Hard: 'صعب' };
const DIFFICULTY_LABEL_EN = { Easy: 'easy', Medium: 'medium', Hard: 'hard' };

// ── Arabic MCQ prompt ────────────────────────────────────────────────────────────
export function buildArabicPrompt({ context, count, difficulty, pointValue }) {
  const diffLabel = DIFFICULTY_LABEL_AR[difficulty] || difficulty;
  const system =
    'أنت خبير في تأليف أسئلة اختيار من متعدد (MCQ) باللغة العربية للمناهج المصرية للصف الثالث الثانوي. ' +
    'يقوم المعلم بتزويدك بفقرة من كتاب مدرسي ومستوى صعوبة وعدد الأسئلة المطلوبة. ' +
    'يجب أن تكون الأسئلة دقيقة ومستمدة من الفقرة، وأن يكون لكل سؤال 4 خيارات مع إجابة صحيحة واحدة فقط. ' +
    'أرجع النتيجة بصيغة JSON صارمة بالشكل: ' +
    '{"questions":[{"text":"...","options":["...","...","...","..."],"correctIndex":0,"pointValue":1}]}. ' +
    'لا تضف أي شرح خارج كائن JSON.';

  const user =
    `مستوى الصعوبة: ${diffLabel}\n` +
    `عدد الأسئلة المطلوبة: ${count}\n` +
    `القيمة الافتراضية لكل سؤال: ${pointValue}\n\n` +
    `الفقرة من الكتاب المدرسي:\n"""\n${context}\n"""\n\n` +
    `ألّف ${count} سؤال اختيار من متعدد باللغة العربية مستندة إلى الفقرة أعلاه، ` +
    `بمستوى صعوبة ${diffLabel}. كل سؤال له 4 خيارات وإجابة صحيحة واحدة. أرجع JSON فقط.`;

  return { system, user };
}

// ── English MCQ prompt ───────────────────────────────────────────────────────────
export function buildEnglishPrompt({ context, count, difficulty, pointValue }) {
  const diffLabel = DIFFICULTY_LABEL_EN[difficulty] || difficulty.toLowerCase();
  const system =
    'You are an expert at writing multiple-choice questions (MCQs) in English for the Egyptian ' +
    'third-secondary curriculum. You are given a passage from a textbook, a difficulty level, ' +
    'and the number of questions to produce. Questions must be accurate, grounded in the passage, ' +
    'and each must have exactly 4 options with exactly one correct answer. ' +
    'Return STRICT JSON in this shape: ' +
    '{"questions":[{"text":"...","options":["...","...","...","..."],"correctIndex":0,"pointValue":1}]}. ' +
    'Do not add any explanation outside the JSON object.';

  const user =
    `Difficulty: ${diffLabel}\n` +
    `Number of questions required: ${count}\n` +
    `Default point value per question: ${pointValue}\n\n` +
    `Textbook passage:\n"""\n${context}\n"""\n\n` +
    `Write ${count} English multiple-choice questions based on the passage above at ${diffLabel} ` +
    `difficulty. Each question must have 4 options and exactly one correct answer. Return JSON only.`;

  return { system, user };
}

export { DIFFICULTY_LABEL_AR, DIFFICULTY_LABEL_EN };
