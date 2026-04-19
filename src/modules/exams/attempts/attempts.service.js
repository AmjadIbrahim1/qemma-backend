// backend/src/modules/exams/attempts/attempts.service.js

import prisma from '../../../config/prisma.config.js';

class AttemptsService {

  // ── Get all attempts for teacher's exams ─────────────────────
  async getTeacherAttempts(teacherId, { examId, courseId, status, page = 1, limit = 20 } = {}) {
    const skip = (page - 1) * limit;

    const where = {
      exam: {
        teacherId,
        ...(courseId && { courseId }),
        ...(examId && { id: examId }),
      },
      ...(status === 'pending' && { submittedAt: { not: null }, score: null }),
      ...(status === 'graded'  && { score: { not: null } }),
    };

    const [attempts, total] = await Promise.all([
      prisma.examAttempt.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { submittedAt: 'desc' },
        include: {
          exam: {
            select: { id: true, title: true, totalMarks: true, passingMarks: true, courseId: true },
          },
          student: {
            include: {
              user: { select: { id: true, name: true, avatar: true } },
            },
          },
        },
      }),
      prisma.examAttempt.count({ where }),
    ]);

    return {
      attempts,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── Get single attempt with full details ──────────────────────
  async getAttemptById(attemptId) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            questions: { orderBy: { order: 'asc' } },
          },
        },
        student: {
          include: {
            user: { select: { id: true, name: true, avatar: true, email: true } },
          },
        },
      },
    });

    if (!attempt) {
      const err = new Error('Attempt not found');
      err.statusCode = 404;
      throw err;
    }

    return attempt;
  }

  // ── Grade a single attempt ────────────────────────────────────
  async gradeAttempt(attemptId, { score, feedback }) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: true },
    });

    if (!attempt) {
      const err = new Error('Attempt not found');
      err.statusCode = 404;
      throw err;
    }

    const isPassed = score >= attempt.exam.passingMarks;

    const updated = await prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        score,
        isPassed,
        finishedAt: new Date(),
      },
    });

    // Upsert grade record
    await prisma.grade.upsert({
      where: {
        studentId_examId: {
          studentId: attempt.studentId,
          examId: attempt.examId,
        },
      },
      update: { score, gradedAt: new Date() },
      create: {
        studentId: attempt.studentId,
        examId:    attempt.examId,
        score,
        gradedAt:  new Date(),
      },
    });

    return updated;
  }

  // ── Auto-grade MCQ/true-false attempt ─────────────────────────
  async autoGrade(attemptId) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: { questions: true },
        },
      },
    });

    if (!attempt) {
      const err = new Error('Attempt not found');
      err.statusCode = 404;
      throw err;
    }

    const answers = attempt.answers || {};
    let totalScore = 0;

    for (const question of attempt.exam.questions) {
      const studentAnswer = answers[question.id];
      if (studentAnswer && studentAnswer === question.correctAnswer) {
        totalScore += question.marks;
      }
    }

    return await this.gradeAttempt(attemptId, { score: totalScore });
  }

  // ── Get stats for teacher's exams ─────────────────────────────
  async getExamStats(teacherId) {
    const exams = await prisma.exam.findMany({
      where: { teacherId },
      include: {
        attempts: {
          where: { submittedAt: { not: null } },
          select: { score: true, isPassed: true, submittedAt: true },
        },
        _count: { select: { attempts: true } },
      },
    });

    return exams.map(exam => {
      const submitted = exam.attempts.filter(a => a.submittedAt);
      const graded    = exam.attempts.filter(a => a.score !== null);
      const pending   = submitted.filter(a => a.score === null);
      const passed    = graded.filter(a => a.isPassed);
      const avgScore  = graded.length > 0
        ? graded.reduce((sum, a) => sum + (a.score || 0), 0) / graded.length
        : 0;

      return {
        examId:       exam.id,
        title:        exam.title,
        totalMarks:   exam.totalMarks,
        passingMarks: exam.passingMarks,
        submitted:    submitted.length,
        graded:       graded.length,
        pending:      pending.length,
        passed:       passed.length,
        avgScore:     Math.round(avgScore * 10) / 10,
        passRate:     graded.length > 0 ? Math.round((passed.length / graded.length) * 100) : 0,
      };
    });
  }
}

export default new AttemptsService();