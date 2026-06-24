import prisma from '../../config/prisma.config.js';
import notificationsService from '../notifications/notifications.service.js';

class ExamsService {

  async _getStudent(userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('Student profile not found'), { statusCode: 404 });
    return student;
  }

  async _getTeacher(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) throw Object.assign(new Error('Teacher profile not found'), { statusCode: 403 });
    return teacher;
  }

  async _emitToEnrolledStudents(courseId, event, payload) {
    try {
      const { getIO } = await import('../../socket/socket.config.js');
      const io = getIO();
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId },
        include: { student: { select: { userId: true } } },
      });
      for (const e of enrollments) {
        io.to(`user:${e.student.userId}`).emit(event, payload);
      }
    } catch (_) { /* Socket not available */ }
  }

  // ── CREATE ──────────────────────────────────────────────────
  async createExam(userId, data) {
    const teacher = await this._getTeacher(userId);

    const {
      courseId, title, description, durationMinutes,
      totalMarks, passingMarks, availableFrom, availableTo,
       isPublished, questions = [],
    } = data;

    if (!courseId)      throw Object.assign(new Error('الكورس مطلوب'),                    { statusCode: 400 });
    if (!title?.trim()) throw Object.assign(new Error('عنوان الاختبار مطلوب'),            { statusCode: 400 });
    if (!durationMinutes || durationMinutes < 1)
                        throw Object.assign(new Error('مدة الاختبار مطلوبة'),             { statusCode: 400 });
    if (questions.length === 0)
                        throw Object.assign(new Error('يجب إضافة سؤال واحد على الأقل'),  { statusCode: 400 });

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.teacherId !== teacher.id)
      throw Object.assign(new Error('الكورس غير موجود أو غير مصرح'), { statusCode: 403 });

    const published = Boolean(isPublished);

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
      
          isPublished:     published,
        },
      });

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

      return tx.exam.findUnique({
        where:   { id: newExam.id },
        include: {
          _count:    { select: { questions: true, attempts: true } },
          questions: { orderBy: { order: 'asc' } },
          course:    { select: { title: true } },
        },
      });
    });

    const formatted = this._format(exam);
    if (published) {
      await this._emitToEnrolledStudents(courseId, 'exam:published', formatted);
      await notificationsService.notifyEnrolledStudents(
        courseId,
        `تم إضافة اختبار جديد في كورس ${exam.course?.title || ''}`,
        'exam_published',
        { link: `/student/exams/${exam.id}` }
      );
    }
    return formatted;
  }

  // ── TEACHER: list own exams ─────────────────────────────────
  async getTeacherExams(userId) {
    const teacher = await this._getTeacher(userId);
    const exams = await prisma.exam.findMany({
      where:   { teacherId: teacher.id },
      include: { _count: { select: { questions: true, attempts: true } }, course: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return exams.map(e => this._format(e));
  }

  // ── TEACHER: get attempts for one exam ──────────────────────
  async getExamAttempts(examId, userId) {
    const teacher = await this._getTeacher(userId);
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.teacherId !== teacher.id)
      throw Object.assign(new Error('Exam not found or unauthorized'), { statusCode: 403 });

    return prisma.examAttempt.findMany({
      where:   { examId },
      include: { student: { include: { user: { select: { name: true, email: true } } } } },
      orderBy: { submittedAt: 'desc' },
    });
  }

  // ── STUDENT: all exams from enrolled courses ────────────────
  async getStudentExams(userId) {
    // ✅ إذا مفيش student profile، ارجع array فاضية بدل throw
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) return [];

    const enrollments = await prisma.enrollment.findMany({
      where:  { studentId: student.id },
      select: { courseId: true },
    });

    const courseIds = enrollments.map(e => e.courseId);
    if (courseIds.length === 0) return [];

    // ✅ جلب كل الامتحانات المنشورة من الكورسات المشترك فيها
    const exams = await prisma.exam.findMany({
      where: {
        courseId:    { in: courseIds },
        isPublished: true,
      },
      include: {
        _count:  { select: { questions: true, attempts: true } },
        course:  { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (exams.length === 0) return [];

    // جلب محاولات الطالب
    const examIds = exams.map(e => e.id);
    const attempts = await prisma.examAttempt.findMany({
      where: { examId: { in: examIds }, studentId: student.id },
      select: { examId: true, score: true, isPassed: true, submittedAt: true },
    });

    const attemptMap = {};
    attempts.forEach(a => { attemptMap[a.examId] = a; });

    const now = new Date();

    return exams.map(exam => {
      const myAttempt   = attemptMap[exam.id] || null;
      const isAvailable =
        exam.isPublished &&
        (!exam.availableFrom || new Date(exam.availableFrom) <= now) &&
        (!exam.availableTo   || new Date(exam.availableTo)   >= now);

      return {
        id:              exam.id,
        courseId:        exam.courseId,
        courseTitle:     exam.course?.title   ?? null,
        title:           exam.title,
        description:     exam.description     ?? null,
        duration:        exam.duration,
        durationMinutes: exam.durationMinutes ?? exam.duration,
        totalMarks:      exam.totalMarks,
        passingMarks:    exam.passingMarks,
        availableFrom:   exam.availableFrom   ?? null,
        availableTo:     exam.availableTo     ?? null,
        
        isPublished:     exam.isPublished,
        isAvailable,
        questionsCount:  exam._count?.questions ?? 0,
        attemptsCount:   exam._count?.attempts  ?? 0,
        myAttempt,
        hasCompleted:    !!myAttempt,
        createdAt:       exam.createdAt,
      };
    });
  }

  // ── GET single exam ─────────────────────────────────────────
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

  // ── UPDATE ──────────────────────────────────────────────────
  async updateExam(examId, userId, data) {
    const teacher = await this._getTeacher(userId);
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.teacherId !== teacher.id)
      throw Object.assign(new Error('Exam not found or unauthorized'), { statusCode: 404 });

    const {
      title, description, durationMinutes, totalMarks,
      passingMarks, availableFrom, availableTo,  isPublished,
    } = data;

    const wasPublished = exam.isPublished;
    const willPublish  = isPublished !== undefined ? Boolean(isPublished) : wasPublished;

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
       
        ...(isPublished     !== undefined && { isPublished:   willPublish }),
      },
      include: { _count: { select: { questions: true, attempts: true } }, course: { select: { title: true } } },
    });

    const formatted = this._format(updated);
    if (!wasPublished && willPublish)
      await this._emitToEnrolledStudents(exam.courseId, 'exam:published', formatted);
    return formatted;
  }

  // ── DELETE ──────────────────────────────────────────────────
  async deleteExam(examId, userId) {
    const teacher = await this._getTeacher(userId);
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.teacherId !== teacher.id)
      throw Object.assign(new Error('Exam not found or unauthorized'), { statusCode: 404 });
    await prisma.exam.delete({ where: { id: examId } });
    return { message: 'Exam deleted successfully' };
  }

  // ── TOGGLE PUBLISH ──────────────────────────────────────────
  async togglePublish(examId, userId) {
    const teacher = await this._getTeacher(userId);
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.teacherId !== teacher.id)
      throw Object.assign(new Error('Exam not found or unauthorized'), { statusCode: 404 });

    const newPublished = !exam.isPublished;
    const updated = await prisma.exam.update({
      where: { id: examId },
      data:  { isPublished: newPublished },
      include: { _count: { select: { questions: true, attempts: true } }, course: { select: { title: true } } },
    });

    if (newPublished)
      await this._emitToEnrolledStudents(exam.courseId, 'exam:published', this._format(updated));
    return { isPublished: updated.isPublished };
  }

  // ── FORMAT ──────────────────────────────────────────────────
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