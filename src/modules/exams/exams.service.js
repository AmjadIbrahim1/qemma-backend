// backend/src/modules/exams/exams.service.js

import prisma from '../../config/prisma.config.js';

class ExamsService {

  // ── Helper: get teacher record ──────────────────────────────────
  async _getTeacher(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) {
      throw Object.assign(new Error('Teacher profile not found'), { statusCode: 403 });
    }
    return teacher;
  }

  // ── CREATE exam with questions ──────────────────────────────────
  async createExam(userId, data) {
    const teacher = await this._getTeacher(userId);

    const {
      courseId,
      title,
      description,
      durationMinutes,
      totalMarks,
      passingMarks,
      availableFrom,
      availableTo,
      proctored,
      isPublished,
      questions = [],
    } = data;

    if (!courseId)      throw Object.assign(new Error('الكورس مطلوب'),              { statusCode: 400 });
    if (!title?.trim()) throw Object.assign(new Error('عنوان الاختبار مطلوب'),     { statusCode: 400 });
    if (!durationMinutes || durationMinutes < 1)
      throw Object.assign(new Error('مدة الاختبار مطلوبة'),                        { statusCode: 400 });
    if (questions.length === 0)
      throw Object.assign(new Error('يجب إضافة سؤال واحد على الأقل'),             { statusCode: 400 });

    // Verify teacher owns the course
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.teacherId !== teacher.id) {
      throw Object.assign(new Error('الكورس غير موجود أو غير مصرح'), { statusCode: 403 });
    }

    // Create exam + questions in one transaction
    const exam = await prisma.$transaction(async (tx) => {
      const newExam = await tx.exam.create({
        data: {
          courseId,
          teacherId:       teacher.id,
          title:           title.trim(),
          description:     description || null,
          duration:        parseInt(durationMinutes),
          durationMinutes: parseInt(durationMinutes),
          totalMarks:      parseInt(totalMarks)   || 100,
          passingMarks:    parseInt(passingMarks) || 50,
          availableFrom:   availableFrom ? new Date(availableFrom) : null,
          availableTo:     availableTo   ? new Date(availableTo)   : null,
          proctored:       Boolean(proctored),
          isPublished:     Boolean(isPublished),
        },
      });

      // Insert questions
      if (questions.length > 0) {
        await tx.question.createMany({
          data: questions.map((q, index) => ({
            examId:        newExam.id,
            type:          q.type          || 'multiple-choice',
            questionText:  q.questionText,
            body:          q.questionText,
            qtype:         q.type          || 'multiple-choice',
            options:       q.options       || [],
            correctAnswer: q.correctAnswer || null,
            marks:         parseInt(q.marks) || 1,
            points:        parseInt(q.marks) || 1,
            order:         q.order         || index + 1,
          })),
        });
      }

      // Return with questions count
      return await tx.exam.findUnique({
        where:   { id: newExam.id },
        include: {
          _count:    { select: { questions: true, attempts: true } },
          questions: { orderBy: { order: 'asc' } },
          course:    { select: { title: true } },
        },
      });
    });

    return this._format(exam);
  }

  // ── LIST teacher's exams ────────────────────────────────────────
  async getTeacherExams(userId) {
    const teacher = await this._getTeacher(userId);

    const exams = await prisma.exam.findMany({
      where:   { teacherId: teacher.id },
      include: {
        _count:  { select: { questions: true, attempts: true } },
        course:  { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return exams.map(e => this._format(e));
  }

  // ── GET exam attempts ─────────────────────────────────────────── ✅ NEW
  async getExamAttempts(examId, userId) {
    const teacher = await this._getTeacher(userId);

    // Verify the exam belongs to this teacher
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.teacherId !== teacher.id) {
      throw Object.assign(new Error('Exam not found or unauthorized'), { statusCode: 403 });
    }

    // Try ExamAttempt model first, fallback to Attempt
    let attempts = [];
    try {
      attempts = await prisma.examAttempt.findMany({
        where:   { examId },
        include: {
          student: {
            include: {
              user: { select: { name: true, email: true } },
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
      });
    } catch {
      // Fallback: try generic Attempt model if ExamAttempt doesn't exist in schema
      try {
        attempts = await prisma.attempt.findMany({
          where:   { examId },
          include: {
            student: {
              include: {
                user: { select: { name: true, email: true } },
              },
            },
          },
          orderBy: { submittedAt: 'desc' },
        });
      } catch {
        attempts = [];
      }
    }

    return attempts;
  }

  // ── GET single exam ─────────────────────────────────────────────
  async getExam(examId, userId) {
    const exam = await prisma.exam.findUnique({
      where:   { id: examId },
      include: {
        questions: { orderBy: { order: 'asc' } },
        _count:    { select: { attempts: true } },
        course:    { select: { title: true } },
      },
    });

    if (!exam) throw Object.assign(new Error('Exam not found'), { statusCode: 404 });
    return this._format(exam);
  }

  // ── UPDATE exam ─────────────────────────────────────────────────
  async updateExam(examId, userId, data) {
    const teacher = await this._getTeacher(userId);

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.teacherId !== teacher.id) {
      throw Object.assign(new Error('Exam not found or unauthorized'), { statusCode: 404 });
    }

    const {
      title, description, durationMinutes, totalMarks,
      passingMarks, availableFrom, availableTo,
      proctored, isPublished,
    } = data;

    const updated = await prisma.exam.update({
      where: { id: examId },
      data: {
        ...(title           && { title: title.trim() }),
        ...(description     !== undefined && { description }),
        ...(durationMinutes && { duration: parseInt(durationMinutes), durationMinutes: parseInt(durationMinutes) }),
        ...(totalMarks      && { totalMarks:   parseInt(totalMarks) }),
        ...(passingMarks    && { passingMarks: parseInt(passingMarks) }),
        ...(availableFrom   !== undefined && { availableFrom: availableFrom ? new Date(availableFrom) : null }),
        ...(availableTo     !== undefined && { availableTo:   availableTo   ? new Date(availableTo)   : null }),
        ...(proctored       !== undefined && { proctored:    Boolean(proctored) }),
        ...(isPublished     !== undefined && { isPublished:  Boolean(isPublished) }),
      },
      include: {
        _count:  { select: { questions: true, attempts: true } },
        course:  { select: { title: true } },
      },
    });

    return this._format(updated);
  }

  // ── DELETE exam ─────────────────────────────────────────────────
  async deleteExam(examId, userId) {
    const teacher = await this._getTeacher(userId);

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.teacherId !== teacher.id) {
      throw Object.assign(new Error('Exam not found or unauthorized'), { statusCode: 404 });
    }

    await prisma.exam.delete({ where: { id: examId } });
    return { message: 'Exam deleted successfully' };
  }

  // ── Toggle publish ──────────────────────────────────────────────
  async togglePublish(examId, userId) {
    const teacher = await this._getTeacher(userId);

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.teacherId !== teacher.id) {
      throw Object.assign(new Error('Exam not found or unauthorized'), { statusCode: 404 });
    }

    const updated = await prisma.exam.update({
      where: { id: examId },
      data:  { isPublished: !exam.isPublished },
    });

    return { isPublished: updated.isPublished };
  }

  // ── Format helper ───────────────────────────────────────────────
  _format(exam) {
    return {
      id:              exam.id,
      courseId:        exam.courseId,
      courseTitle:     exam.course?.title      ?? null,
      teacherId:       exam.teacherId,
      title:           exam.title,
      description:     exam.description        ?? null,
      durationMinutes: exam.durationMinutes    ?? exam.duration,
      totalMarks:      exam.totalMarks,
      passingMarks:    exam.passingMarks,
      availableFrom:   exam.availableFrom      ?? null,
      availableTo:     exam.availableTo        ?? null,
      proctored:       exam.proctored,
      isPublished:     exam.isPublished,
      createdAt:       exam.createdAt,
      updatedAt:       exam.updatedAt,
      stats: exam._count ? {
        questions: exam._count.questions,
        attempts:  exam._count.attempts,
      } : undefined,
      questions: exam.questions?.map(q => ({
        id:            q.id,
        type:          q.type,
        questionText:  q.questionText,
        options:       q.options ?? [],
        correctAnswer: q.correctAnswer,
        marks:         q.marks,
        order:         q.order,
      })) ?? undefined,
    };
  }
}

export default new ExamsService();