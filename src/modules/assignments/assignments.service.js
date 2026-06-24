// backend/src/modules/assignments/assignments.service.js

import prisma from '../../config/prisma.config.js';
import path   from 'path';
import fs     from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

class AssignmentsService {

  // ── helper: get teacher ───────────────────────────────────────
  async _getTeacher(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) throw Object.assign(new Error('Teacher profile not found'), { statusCode: 403 });
    return teacher;
  }

  // ── helper: get student ───────────────────────────────────────
  async _getStudent(userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('Student profile not found'), { statusCode: 403 });
    return student;
  }

  // ── helper: save file to disk ─────────────────────────────────
  _saveFile(file, subfolder) {
    try {
      const uploadDir = path.join(__dirname, '../../../public/uploads/assignments', subfolder);
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      const ext      = path.extname(file.originalname) || '.pdf';
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const filePath = path.join(uploadDir, fileName);

      fs.writeFileSync(filePath, file.buffer);
      return `/uploads/assignments/${subfolder}/${fileName}`;
    } catch (err) {
      console.error('⚠️ Assignment file save error:', err.message);
      return null;
    }
  }

  // ── helper: notify enrolled students ──────────────────────────
  async _notifyEnrolledStudents(courseId, title, body, data = null) {
    try {
      const { getIO } = await import('../../socket/socket.config.js');
      const io = getIO();

      const enrollments = await prisma.enrollment.findMany({
        where: { courseId },
        include: { student: { select: { userId: true } } },
      });

      // Create notifications + emit socket
      for (const e of enrollments) {
        const notification = await prisma.notification.create({
          data: { userId: e.student.userId, type: 'assignment', title, body, data },
        });
        io.to(`user:${e.student.userId}`).emit('notification:new', notification);
        io.to(`user:${e.student.userId}`).emit('assignment:new', { title, body, ...data });
      }
    } catch (_) {
      // Socket not available — silently skip
    }
  }

  // ── GET teacher's courses (for dropdown) ──────────────────────
  async getTeacherCourses(userId) {
    const teacher = await this._getTeacher(userId);
    return prisma.course.findMany({
      where: { teacherId: teacher.id },
      include: {
        _count: { select: { lessons: true, enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── GET lessons for a course (for dropdown) ───────────────────
  async getCourseLessons(userId, courseId) {
    const teacher = await this._getTeacher(userId);
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.teacherId !== teacher.id)
      throw Object.assign(new Error('Course not found or unauthorized'), { statusCode: 403 });

    return prisma.lesson.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, order: true },
    });
  }

  // ── CREATE assignment ─────────────────────────────────────────
  async createAssignment(userId, data) {
    const teacher = await this._getTeacher(userId);

    const { courseId, lessonId, title, description, dueDate, maxScore, isPublished } = data;

    if (!courseId) throw Object.assign(new Error('courseId مطلوب'), { statusCode: 400 });
    if (!title?.trim()) throw Object.assign(new Error('عنوان الواجب مطلوب'), { statusCode: 400 });

    // verify teacher owns course
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.teacherId !== teacher.id)
      throw Object.assign(new Error('الكورس غير موجود أو غير مصرح'), { statusCode: 403 });

    // verify lesson belongs to course if provided
    if (lessonId) {
      const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
      if (!lesson || lesson.courseId !== courseId)
        throw Object.assign(new Error('الدرس غير موجود في هذا الكورس'), { statusCode: 400 });
    }

    const assignment = await prisma.assignment.create({
      data: {
        teacherId:   teacher.id,
        courseId,
        lessonId:    lessonId || null,
        title:       title.trim(),
        description: description || null,
        dueDate:     dueDate ? new Date(dueDate) : null,
        maxScore:    parseInt(maxScore) || 100,
        isPublished: isPublished === true || isPublished === 'true',
      },
    });

    // Notify enrolled students
    if (assignment.isPublished) {
      await this._notifyEnrolledStudents(
        courseId,
        `📝 واجب جديد: ${assignment.title}`,
        `تم إضافة واجب جديد في مقرر ${course.title}.`,
        { assignmentId: assignment.id, courseId, type: 'assignment' },
      );
    }

    return this._formatAssignment(assignment);
  }

  // ── GET teacher's assignments for a course ────────────────────
  async getTeacherAssignments(userId, courseId) {
    const teacher = await this._getTeacher(userId);

    const where = { teacherId: teacher.id };
    if (courseId) where.courseId = courseId;

    const assignments = await prisma.assignment.findMany({
      where,
      include: {
        course: { select: { id: true, title: true } },
        lesson: { select: { id: true, title: true, order: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return assignments.map(a => ({
      ...this._formatAssignment(a),
      courseTitle: a.course?.title || '',
      lessonTitle: a.lesson?.title || null,
      lessonOrder: a.lesson?.order || null,
      submissionsCount: a._count.submissions,
    }));
  }

  // ── GET single assignment with submissions (for teacher review) ─
  async getAssignmentWithSubmissions(userId, assignmentId) {
    const teacher = await this._getTeacher(userId);

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        course: { select: { id: true, title: true } },
        lesson: { select: { id: true, title: true, order: true } },
        submissions: {
          include: {
            student: {
              include: {
                user: { select: { id: true, name: true, avatar: true } },
              },
            },
          },
          orderBy: { submittedAt: 'desc' },
        },
      },
    });

    if (!assignment || assignment.teacherId !== teacher.id)
      throw Object.assign(new Error('Assignment not found or unauthorized'), { statusCode: 404 });

    return {
      ...this._formatAssignment(assignment),
      courseTitle: assignment.course?.title || '',
      lessonTitle: assignment.lesson?.title || null,
      lessonOrder: assignment.lesson?.order || null,
      submissions: assignment.submissions.map(s => ({
        id:            s.id,
        fileUrl:       s.fileUrl,
        fileType:      s.fileType,
        fileName:      s.fileName,
        notes:         s.notes,
        score:         s.score,
        feedback:      s.feedback,
        gradedAt:      s.gradedAt,
        submittedAt:   s.submittedAt,
        studentName:   s.student?.user?.name || 'مجهول',
        studentAvatar: s.student?.user?.avatar || null,
        studentId:     s.studentId,
      })),
    };
  }

  // ── GET student assignments (pending + submitted) ─────────────
  async getStudentAssignments(userId) {
    const student = await this._getStudent(userId);

    // Get all courses the student is enrolled in (paid)
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: student.id },
      include: {
        course: {
          select: { id: true, title: true, teacher: { select: { id: true, userId: true } } },
        },
      },
    });

    const courseIds = enrollments.map(e => e.courseId);

    // Get assignments for enrolled courses
    const assignments = await prisma.assignment.findMany({
      where: {
        courseId: { in: courseIds },
        isPublished: true,
      },
      include: {
        course: { select: { id: true, title: true } },
        lesson: { select: { id: true, title: true, order: true } },
        submissions: {
          where: { studentId: student.id },
          select: { id: true, submittedAt: true, score: true, feedback: true, fileUrl: true, fileName: true },
        },
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return assignments.map(a => {
      const submission = a.submissions?.[0] || null;
      return {
        id:              a.id,
        title:           a.title,
        description:     a.description,
        dueDate:         a.dueDate,
        maxScore:        a.maxScore,
        createdAt:       a.createdAt,
        courseId:        a.courseId,
        courseTitle:     a.course?.title || '',
        lessonId:        a.lessonId,
        lessonTitle:     a.lesson?.title || null,
        submitted:       !!submission,
        submission:      submission ? {
          id: submission.id,
          submittedAt: submission.submittedAt,
          score: submission.score,
          feedback: submission.feedback,
          fileUrl: submission.fileUrl,
          fileName: submission.fileName,
        } : null,
      };
    });
  }

  // ── SUBMIT assignment (student uploads file) ──────────────────
  async submitAssignment(userId, assignmentId, file, notes) {
    const student = await this._getStudent(userId);

    // Check assignment exists and is published
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { course: true },
    });
    if (!assignment || !assignment.isPublished)
      throw Object.assign(new Error('الواجب غير موجود أو غير متاح'), { statusCode: 404 });

    // Check student is enrolled
    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId: student.id, courseId: assignment.courseId } },
    });
    if (!enrollment)
      throw Object.assign(new Error('أنت غير مسجل في هذا الكورس'), { statusCode: 403 });

    // Check if already submitted
    const existing = await prisma.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
    });
    if (existing)
      throw Object.assign(new Error('لقد قمت بتسليم هذا الواجب مسبقاً'), { statusCode: 409 });

    // Save file
    let fileUrl = null;
    let fileType = null;
    let fileName = null;
    if (file) {
      fileUrl = this._saveFile(file, 'submissions');
      fileType = file.mimetype || null;
      fileName = file.originalname || null;
    }

    const submission = await prisma.assignmentSubmission.create({
      data: {
        assignmentId,
        studentId: student.id,
        fileUrl,
        fileType,
        fileName,
        notes: notes || null,
      },
    });

    // Notify teacher
    try {
      const { getIO } = await import('../../socket/socket.config.js');
      const io = getIO();
      const teacherRecord = await prisma.teacher.findUnique({
        where: { id: assignment.course.teacherId },
        select: { userId: true },
      });
      if (teacherRecord?.userId) {
        const notif = await prisma.notification.create({
          data: {
            userId: teacherRecord.userId,
            type: 'assignment_submission',
            title: `📥 تسليم واجب: ${assignment.title}`,
            body: `قام الطالب بتسليم واجب ${assignment.title}`,
            data: { assignmentId, courseId: assignment.courseId, submissionId: submission.id },
          },
        });
        io.to(`user:${teacherRecord.userId}`).emit('notification:new', notif);
      }
    } catch (_) {}

    return {
      id: submission.id,
      fileUrl: submission.fileUrl,
      fileName: submission.fileName,
      notes: submission.notes,
      submittedAt: submission.submittedAt,
    };
  }

  // ── Grade a submission ─────────────────────────────────────────
  async gradeSubmission(userId, submissionId, score, feedback) {
    const teacher = await this._getTeacher(userId);

    const submission = await prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: {
          include: { course: true },
        },
      },
    });
    if (!submission)
      throw Object.assign(new Error('Submission not found'), { statusCode: 404 });
    if (submission.assignment.course.teacherId !== teacher.id)
      throw Object.assign(new Error('Unauthorized'), { statusCode: 403 });

    const updated = await prisma.assignmentSubmission.update({
      where: { id: submissionId },
      data: {
        score: score !== undefined ? parseInt(score) : null,
        feedback: feedback || null,
        gradedAt: new Date(),
      },
    });

    // Notify student
    try {
      const { getIO } = await import('../../socket/socket.config.js');
      const io = getIO();
      const studentRecord = await prisma.student.findUnique({
        where: { id: submission.studentId },
        select: { userId: true },
      });
      if (studentRecord?.userId) {
        const notif = await prisma.notification.create({
        data: {
          userId: studentRecord.userId,
          type: 'assignment_graded',
          title: `📊 تم تصحيح الواجب: ${submission.assignment.title}`,
          body: `حصلت على ${score} من ${submission.assignment.maxScore}`,
          data: { assignmentId: submission.assignmentId, submissionId, courseId: submission.assignment.courseId },
        },
      });
        io.to(`user:${studentRecord.userId}`).emit('notification:new', notif);
      }
    } catch (_) {}

    return {
      id: updated.id,
      score: updated.score,
      feedback: updated.feedback,
      gradedAt: updated.gradedAt,
    };
  }

  // ── format ────────────────────────────────────────────────────
  _formatAssignment(a) {
    return {
      id:          a.id,
      teacherId:   a.teacherId,
      courseId:    a.courseId,
      lessonId:    a.lessonId,
      title:       a.title,
      description: a.description ?? null,
      dueDate:     a.dueDate ?? null,
      maxScore:    a.maxScore,
      attachments: a.attachments,
      isPublished: a.isPublished,
      createdAt:   a.createdAt,
      updatedAt:   a.updatedAt,
    };
  }
}

export default new AssignmentsService();
