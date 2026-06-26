import prisma from '../../../config/prisma.config.js';
import { buildExamPrompt } from './templates/mcq.template.js';
import OpenAI from 'openai';

const GROQ_EXAM_API_KEY = process.env.GROQ_EXAM_API_KEY || '';
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

let groqExamClient = null;
if (GROQ_EXAM_API_KEY) {
  groqExamClient = new OpenAI({
    apiKey: GROQ_EXAM_API_KEY,
    baseURL: GROQ_BASE_URL,
  });
} else {
  console.warn('⚠️ GROQ_EXAM_API_KEY is not set — AI exam generation will be disabled.');
}

function isExamGroqAvailable() {
  return !!groqExamClient;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJSONObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

async function generateExamJSON({ system, user, temperature = 0.5, maxTokens = 5000 }) {
  if (!groqExamClient) {
    throw new Error('Groq exam client is not initialized (GROQ_EXAM_API_KEY missing)');
  }

  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 1000;

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await groqExamClient.chat.completions.create({
        model: GROQ_MODEL,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
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
      const status = err?.status || err?.response?.status;
      const retryable = status === 429 || (status && status >= 500) || !status;
      if (!retryable || attempt === MAX_RETRIES) break;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`⚠️ exam-generator: attempt ${attempt + 1} failed (${err.message}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

class ExamGeneratorService {

  async _getStudent(userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('هذا الحساب ليس حساب طالب'), { statusCode: 404 });
    return student;
  }

  async _checkExamLimit(studentId) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        enrollments: { take: 1 },
        bookPurchases: { take: 1 },
      },
    });

    const hasPurchases = student.enrollments.length > 0 || student.bookPurchases.length > 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayExamsCount = await prisma.aiExam.count({
      where: {
        studentId,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    });

    if (!hasPurchases) {
      if (todayExamsCount >= 1) {
        throw Object.assign(
          new Error('يمكنك إنشاء اختبار واحد فقط. قم بشراء كورس أو كتاب لإنشاء المزيد من الاختبارات.'),
          { statusCode: 403 }
        );
      }
    } else {
      if (todayExamsCount >= 3) {
        throw Object.assign(
          new Error('لقد وصلت إلى الحد الأقصى لإنشاء الاختبارات لهذا اليوم (3 اختبارات).'),
          { statusCode: 403 }
        );
      }
    }
  }

  async generateExam(userId, { grade, subject, chapter, difficulty }) {
    if (!isExamGroqAvailable()) {
      throw Object.assign(
        new Error('خدمة إنشاء الاختبارات غير متاحة حالياً. يرجى المحاولة لاحقاً.'),
        { statusCode: 503 }
      );
    }

    const student = await this._getStudent(userId);
    await this._checkExamLimit(student.id);

    const { system, user } = buildExamPrompt({
      grade,
      subject,
      chapter,
      difficulty,
      questionCount: 10,
    });

    let aiResponse;
    try {
      aiResponse = await generateExamJSON({ system, user, temperature: 0.5, maxTokens: 5000 });
    } catch (err) {
      console.error('AI exam generation failed:', err.message);
      throw Object.assign(
        new Error('فشل إنشاء الاختبار بواسطة الذكاء الاصطناعي. يرجى المحاولة مرة أخرى.'),
        { statusCode: 500 }
      );
    }

    const rawQuestions = Array.isArray(aiResponse?.questions) ? aiResponse.questions : [];
    if (rawQuestions.length === 0) {
      throw Object.assign(
        new Error('لم يتمكن الذكاء الاصطناعي من إنشاء أسئلة. يرجى المحاولة مرة أخرى.'),
        { statusCode: 500 }
      );
    }

    const validQuestions = rawQuestions
      .filter(q => {
        const text = q.questionText?.trim();
        const options = Array.isArray(q.options) ? q.options.filter(o => o?.trim()) : [];
        return text && options.length === 4 && q.correctAnswer?.trim();
      })
      .slice(0, 10);

    if (validQuestions.length === 0) {
      throw Object.assign(
        new Error('لم يتمكن الذكاء الاصطناعي من إنشاء أسئلة صالحة. يرجى المحاولة مرة أخرى.'),
        { statusCode: 500 }
      );
    }

    const totalMarks = validQuestions.length;

    const aiExam = await prisma.$transaction(async (tx) => {
      const exam = await tx.aiExam.create({
        data: {
          studentId: student.id,
          grade,
          subject,
          chapter,
          difficulty,
          totalMarks,
          startedAt: new Date(),
        },
      });

      await tx.aiQuestion.createMany({
        data: validQuestions.map((q, index) => ({
          aiExamId: exam.id,
          questionText: q.questionText.trim(),
          options: q.options.map(o => o.trim()),
          correctAnswer: q.correctAnswer.trim(),
          marks: 1,
          order: index + 1,
        })),
      });

      return tx.aiExam.findUnique({
        where: { id: exam.id },
        include: {
          questions: { orderBy: { order: 'asc' }, select: { id: true, questionText: true, options: true, marks: true, order: true } },
        },
      });
    });

    return {
      id: aiExam.id,
      grade: aiExam.grade,
      subject: aiExam.subject,
      chapter: aiExam.chapter,
      difficulty: aiExam.difficulty,
      totalMarks: aiExam.totalMarks,
      startedAt: aiExam.startedAt,
      questions: aiExam.questions.map(q => ({
        id: q.id,
        questionText: q.questionText,
        options: q.options,
        marks: q.marks,
        order: q.order,
      })),
    };
  }

  async submitExam(userId, examId, answers) {
    const student = await this._getStudent(userId);

    const exam = await prisma.aiExam.findUnique({
      where: { id: examId, studentId: student.id },
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    if (!exam) {
      throw Object.assign(new Error('الاختبار غير موجود.'), { statusCode: 404 });
    }
    if (exam.submittedAt) {
      throw Object.assign(new Error('تم تقديم هذا الاختبار من قبل.'), { statusCode: 400 });
    }

    let score = 0;
    const gradedDetails = [];

    for (const question of exam.questions) {
      const studentAnswer = answers[question.id] ?? null;
      const isCorrect = studentAnswer !== null && studentAnswer === question.correctAnswer;
      if (isCorrect) score += question.marks;
      gradedDetails.push({
        questionId: question.id,
        questionText: question.questionText,
        correct: isCorrect,
        studentAnswer,
        correctAnswer: question.correctAnswer,
        marks: isCorrect ? question.marks : 0,
        maxMarks: question.marks,
      });
    }

    const isPassed = score >= Math.ceil(exam.totalMarks * 0.5);

    const updated = await prisma.aiExam.update({
      where: { id: examId },
      data: {
        answers,
        score,
        passed: isPassed,
        submittedAt: new Date(),
      },
    });

    return {
      id: updated.id,
      score: updated.score,
      totalMarks: updated.totalMarks,
      passed: updated.passed,
      submittedAt: updated.submittedAt,
      gradedDetails,
    };
  }

  async getExamReview(userId, examId) {
    const student = await this._getStudent(userId);

    const exam = await prisma.aiExam.findUnique({
      where: { id: examId, studentId: student.id },
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    if (!exam) {
      throw Object.assign(new Error('الاختبار غير موجود.'), { statusCode: 404 });
    }

    const answers = exam.answers || {};

    const questionsDetailed = exam.questions.map(q => {
      const studentAnswer = answers[q.id] ?? null;
      const isCorrect = studentAnswer !== null && studentAnswer === q.correctAnswer;

      return {
        id: q.id,
        questionText: q.questionText,
        options: q.options,
        marks: q.marks,
        correctAnswer: q.correctAnswer,
        studentAnswer,
        isCorrect,
        marksAwarded: isCorrect ? q.marks : 0,
      };
    });

    return {
      id: exam.id,
      grade: exam.grade,
      subject: exam.subject,
      chapter: exam.chapter,
      difficulty: exam.difficulty,
      score: exam.score,
      totalMarks: exam.totalMarks,
      passed: exam.passed,
      startedAt: exam.startedAt,
      submittedAt: exam.submittedAt,
      questions: questionsDetailed,
    };
  }

  async getMyAiExams(userId) {
    const student = await this._getStudent(userId);

    const exams = await prisma.aiExam.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        grade: true,
        subject: true,
        chapter: true,
        difficulty: true,
        score: true,
        totalMarks: true,
        passed: true,
        submittedAt: true,
        createdAt: true,
        _count: { select: { questions: true } },
      },
    });

    return exams.map(e => ({
      id: e.id,
      grade: e.grade,
      subject: e.subject,
      chapter: e.chapter,
      difficulty: e.difficulty,
      score: e.score,
      totalMarks: e.totalMarks,
      passed: e.passed,
      submittedAt: e.submittedAt,
      createdAt: e.createdAt,
      questionsCount: e._count.questions,
      isCompleted: !!e.submittedAt,
    }));
  }

  async checkLimit(userId) {
    try {
      const student = await this._getStudent(userId);

      const studentData = await prisma.student.findUnique({
        where: { id: student.id },
        include: {
          enrollments: { take: 1 },
          bookPurchases: { take: 1 },
        },
      });

      const hasPurchases = studentData.enrollments.length > 0 || studentData.bookPurchases.length > 0;
      const maxExams = hasPurchases ? 3 : 1;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const todayExamsCount = await prisma.aiExam.count({
        where: {
          studentId: student.id,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
      });

      return {
        canGenerate: todayExamsCount < maxExams,
        usedToday: todayExamsCount,
        maxPerDay: maxExams,
        hasPurchases,
      };
    } catch {
      return { canGenerate: false, usedToday: 0, maxPerDay: 0, hasPurchases: false };
    }
  }
}

export default new ExamGeneratorService();
