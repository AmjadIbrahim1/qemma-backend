// backend/src/modules/lessons/lessons.service.js

import prisma from '../../config/prisma.config.js';
import notificationsService from '../notifications/notifications.service.js';
import path   from 'path';
import fs     from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

class LessonsService {

  // ── helper: get teacher ───────────────────────────────────────
  async _getTeacher(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) throw Object.assign(new Error('Teacher profile not found'), { statusCode: 403 });
    return teacher;
  }

  // ── helper: save file to disk ─────────────────────────────────
  _saveFile(file, subfolder) {
    try {
      const uploadDir = path.join(__dirname, '../../../public/uploads/lessons', subfolder);
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      const ext      = path.extname(file.originalname) || (subfolder === 'pdfs' ? '.pdf' : '.mp4');
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const filePath = path.join(uploadDir, fileName);

      fs.writeFileSync(filePath, file.buffer);
      return `/uploads/lessons/${subfolder}/${fileName}`;
    } catch (err) {
      console.error('⚠️ File save error:', err.message);
      return null;
    }
  }

  // ── helper: emit lesson:published to all enrolled students ────
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
    } catch (_) {
      // Socket not available — silently skip
    }
  }

  // ── CREATE lesson ─────────────────────────────────────────────
  async createLesson(userId, data, videoFile, pdfFile) {
    const teacher = await this._getTeacher(userId);

    const { courseId, title, content, summary, order, isPublished } = data;

    if (!courseId)      throw Object.assign(new Error('courseId مطلوب'),                        { statusCode: 400 });
    if (!title?.trim()) throw Object.assign(new Error('عنوان الدرس مطلوب'),                    { statusCode: 400 });
    if (!videoFile && !pdfFile)
      throw Object.assign(new Error('يرجى رفع فيديو أو PDF على الأقل'),                       { statusCode: 400 });

    // verify teacher owns course
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.teacherId !== teacher.id)
      throw Object.assign(new Error('الكورس غير موجود أو غير مصرح'),                          { statusCode: 403 });

    // save files
    const videoUrl   = videoFile ? this._saveFile(videoFile, 'videos') : null;
    const pdfFileRef = pdfFile   ? this._saveFile(pdfFile,   'pdfs')   : null;

    // auto-order if not provided
    let lessonOrder = parseInt(order) || null;
    if (!lessonOrder) {
      const count = await prisma.lesson.count({ where: { courseId } });
      lessonOrder = count + 1;
    }

    const published = isPublished === 'true' || isPublished === true;

    const lesson = await prisma.lesson.create({
      data: {
        courseId,
        title:       title.trim(),
        content:     content     || null,
        summary:     summary     || null,
        videoUrl,
        pdfFileRef,
        order:       lessonOrder,
        orderIndex:  lessonOrder,
        isPublished: published,
      },
    });

    const formatted = this._format(lesson);

    // ✅ Realtime: notify enrolled students if lesson is published
    if (published) {
      await this._emitToEnrolledStudents(courseId, 'lesson:published', formatted);
      await notificationsService.notifyEnrolledStudents(
        courseId,
        `📚 درس جديد: ${lesson.title}`,
        'lesson_published',
      );
    }

    return formatted;
  }

  // ── GET course lessons ────────────────────────────────────────
  async getCourseLessons(courseId, userId) {
    // if teacher → show all; if student → show published only
    let isTeacher = false;
    if (userId) {
      const teacher = await prisma.teacher.findUnique({ where: { userId } });
      if (teacher) {
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        isTeacher = course?.teacherId === teacher.id;
      }
    }

    const lessons = await prisma.lesson.findMany({
      where: {
        courseId,
        ...(isTeacher ? {} : { isPublished: true }),
      },
      orderBy: { order: 'asc' },
    });

    return lessons.map(l => this._format(l));
  }

  // ── GET single lesson ─────────────────────────────────────────
  async getLesson(lessonId, userId) {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });

    // mark attendance if student
    if (userId) {
      const student = await prisma.student.findUnique({ where: { userId } });
      if (student) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        await prisma.attendance.upsert({
          where: {
            studentId_lessonId_attendDate: {
              studentId:  student.id,
              lessonId:   lesson.id,
              attendDate: today,
            },
          },
          create: { studentId: student.id, lessonId: lesson.id, attendDate: today, present: true },
          update: { present: true },
        });
      }
    }

    return this._format(lesson);
  }

  // ── UPDATE lesson ─────────────────────────────────────────────
  async updateLesson(lessonId, userId, data, videoFile, pdfFile) {
    const teacher = await this._getTeacher(userId);

    const lesson = await prisma.lesson.findUnique({
      where:   { id: lessonId },
      include: { course: true },
    });
    if (!lesson || lesson.course.teacherId !== teacher.id)
      throw Object.assign(new Error('Lesson not found or unauthorized'), { statusCode: 404 });

    const videoUrl   = videoFile ? this._saveFile(videoFile, 'videos') : undefined;
    const pdfFileRef = pdfFile   ? this._saveFile(pdfFile,   'pdfs')   : undefined;

    const wasPublished = lesson.isPublished;
    const willPublish  = data.isPublished !== undefined
      ? (data.isPublished === 'true' || data.isPublished === true)
      : wasPublished;

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        ...(data.title       && { title:       data.title.trim() }),
        ...(data.content     !== undefined && { content:     data.content }),
        ...(data.summary     !== undefined && { summary:     data.summary }),
        ...(data.order       && { order:       parseInt(data.order), orderIndex: parseInt(data.order) }),
        ...(data.isPublished !== undefined && { isPublished: willPublish }),
        ...(videoUrl   !== undefined && { videoUrl }),
        ...(pdfFileRef !== undefined && { pdfFileRef }),
      },
    });

    const formatted = this._format(updated);

    // ✅ Realtime: emit if newly published (was false, now true)
    if (!wasPublished && willPublish) {
      await this._emitToEnrolledStudents(lesson.courseId, 'lesson:published', formatted);
      await notificationsService.notifyEnrolledStudents(
        lesson.courseId,
        `📚 درس جديد: ${lesson.title}`,
        'lesson_published',
      );
    }

    return formatted;
  }

  // ── DELETE lesson ─────────────────────────────────────────────
  async deleteLesson(lessonId, userId) {
    const teacher = await this._getTeacher(userId);

    const lesson = await prisma.lesson.findUnique({
      where:   { id: lessonId },
      include: { course: true },
    });
    if (!lesson || lesson.course.teacherId !== teacher.id)
      throw Object.assign(new Error('Lesson not found or unauthorized'), { statusCode: 404 });

    await prisma.lesson.delete({ where: { id: lessonId } });
    return { message: 'Lesson deleted successfully' };
  }

  // ── format ────────────────────────────────────────────────────
  _format(lesson) {
    return {
      id:          lesson.id,
      courseId:    lesson.courseId,
      title:       lesson.title,
      content:     lesson.content     ?? null,
      summary:     lesson.summary     ?? null,
      videoUrl:    lesson.videoUrl    ?? null,
      pdfFileRef:  lesson.pdfFileRef  ?? null,
      order:       lesson.order,
      isPublished: lesson.isPublished,
      createdAt:   lesson.createdAt,
      updatedAt:   lesson.updatedAt,
    };
  }
}

export default new LessonsService();