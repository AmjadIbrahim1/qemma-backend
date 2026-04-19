// backend/src/modules/lessons/lessons.service.js
// CHANGES:
//   • createLesson يحفظ الفيديو و PDF على local storage
//   • يربط الدرس بالكورس الحقيقي في الـ database عبر Prisma
//   • بيتأكد إن المدرس صاحب الكورس قبل ما يضيف الدرس

import prisma from '../../config/prisma.config.js';
import crypto from 'crypto';
import path   from 'path';
import fs     from 'fs';

// ── File upload helpers ────────────────────────────────────────────────────

function saveFile(buffer, originalName, subfolder) {
  const ext      = path.extname(originalName) || '';
  const filename = `${crypto.randomUUID()}${ext}`;
  const dir      = path.join(process.cwd(), 'public', 'uploads', 'lessons', subfolder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/lessons/${subfolder}/${filename}`;
}

function deleteFile(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  try {
    const localPath = path.join(process.cwd(), 'public', url);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } catch (err) {
    console.warn('⚠️ Could not delete file:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────

class LessonsService {

  // ── Helper: get teacher record ──────────────────────────────────────────
  async _getTeacher(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) {
      throw Object.assign(new Error('Teacher profile not found'), { statusCode: 403 });
    }
    return teacher;
  }

  // ── CREATE lesson ───────────────────────────────────────────────────────
  async createLesson(userId, data, videoFile, pdfFile) {
    const teacher = await this._getTeacher(userId);

    const {
      courseId,
      title,
      content,
      summary,
      order,
      isPublished,
    } = data;

    if (!courseId)     throw Object.assign(new Error('الكورس مطلوب'),         { statusCode: 400 });
    if (!title?.trim()) throw Object.assign(new Error('عنوان الدرس مطلوب'),  { statusCode: 400 });
    if (!videoFile && !pdfFile)
      throw Object.assign(new Error('يرجى رفع فيديو أو ملف PDF على الأقل'), { statusCode: 400 });

    // ── Verify teacher owns the course ─────────────────────────────────
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.teacherId !== teacher.id) {
      throw Object.assign(new Error('الكورس غير موجود أو غير مصرح'), { statusCode: 403 });
    }

    // ── Save files locally ─────────────────────────────────────────────
    let videoUrl    = null;
    let pdfUrl      = null;

    if (videoFile) {
      videoUrl = saveFile(videoFile.buffer, videoFile.originalname, 'videos');
    }
    if (pdfFile) {
      pdfUrl = saveFile(pdfFile.buffer, pdfFile.originalname, 'pdfs');
    }

    // ── Calculate next order if not provided ───────────────────────────
    let lessonOrder = parseInt(order) || 1;
    if (!order) {
      const count = await prisma.lesson.count({ where: { courseId } });
      lessonOrder = count + 1;
    }

    // ── Persist to database ────────────────────────────────────────────
    const lesson = await prisma.lesson.create({
      data: {
        courseId,
        title:       title.trim(),
        content:     content    || null,
        summary:     summary    || null,
        videoUrl:    videoUrl,         // saved in `video_url` column
        pdfFileRef:  pdfUrl,           // saved in `pdf_file_ref` column
        order:       lessonOrder,
        isPublished: isPublished === 'true' || isPublished === true,
      },
    });

    return this._format(lesson);
  }

  // ── LIST lessons for a course ───────────────────────────────────────────
  async getCourseLessons(courseId, userId) {
    // Verify course exists and is accessible
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 });

    const lessons = await prisma.lesson.findMany({
      where:   { courseId },
      orderBy: { order: 'asc' },
    });

    return lessons.map(l => this._format(l));
  }

  // ── GET single lesson ───────────────────────────────────────────────────
  async getLesson(lessonId, userId) {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
    return this._format(lesson);
  }

  // ── UPDATE lesson ───────────────────────────────────────────────────────
  async updateLesson(lessonId, userId, data, videoFile, pdfFile) {
    const teacher = await this._getTeacher(userId);

    const lesson = await prisma.lesson.findUnique({
      where:   { id: lessonId },
      include: { course: true },
    });
    if (!lesson || lesson.course.teacherId !== teacher.id) {
      throw Object.assign(new Error('Lesson not found or unauthorized'), { statusCode: 404 });
    }

    let videoUrl   = lesson.videoUrl;
    let pdfUrl     = lesson.pdfFileRef;

    if (videoFile) {
      deleteFile(lesson.videoUrl);
      videoUrl = saveFile(videoFile.buffer, videoFile.originalname, 'videos');
    }
    if (pdfFile) {
      deleteFile(lesson.pdfFileRef);
      pdfUrl = saveFile(pdfFile.buffer, pdfFile.originalname, 'pdfs');
    }

    const { title, content, summary, order, isPublished } = data;

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data:  {
        ...(title       && { title: title.trim() }),
        ...(content     !== undefined && { content }),
        ...(summary     !== undefined && { summary }),
        ...(order       !== undefined && { order: parseInt(order) }),
        ...(isPublished !== undefined && { isPublished: isPublished === 'true' || isPublished === true }),
        videoUrl,
        pdfFileRef: pdfUrl,
      },
    });

    return this._format(updated);
  }

  // ── DELETE lesson ───────────────────────────────────────────────────────
  async deleteLesson(lessonId, userId) {
    const teacher = await this._getTeacher(userId);

    const lesson = await prisma.lesson.findUnique({
      where:   { id: lessonId },
      include: { course: true },
    });
    if (!lesson || lesson.course.teacherId !== teacher.id) {
      throw Object.assign(new Error('Lesson not found or unauthorized'), { statusCode: 404 });
    }

    deleteFile(lesson.videoUrl);
    deleteFile(lesson.pdfFileRef);

    await prisma.lesson.delete({ where: { id: lessonId } });
    return { message: 'Lesson deleted successfully' };
  }

  // ── Format helper ───────────────────────────────────────────────────────
  _format(lesson) {
    return {
      id:          lesson.id,
      courseId:    lesson.courseId,
      title:       lesson.title,
      content:     lesson.content     ?? null,
      summary:     lesson.summary     ?? null,
      videoUrl:    lesson.videoUrl    ?? null,
      pdfUrl:      lesson.pdfFileRef  ?? null,
      order:       lesson.order,
      isPublished: lesson.isPublished,
      createdAt:   lesson.createdAt,
      updatedAt:   lesson.updatedAt,
    };
  }
}

export default new LessonsService();