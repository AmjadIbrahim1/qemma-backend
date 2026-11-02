// backend/src/modules/schedule/schedule.service.js

import prisma from '../../config/prisma.config.js';

class ScheduleService {

  async _getTeacher(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 403 });
    return teacher;
  }

  // ── إضافة حصة ────────────────────────────────────────────────────────
  async createSchedule(userId, data) {
    const teacher = await this._getTeacher(userId);

    const {
      title, courseId, date, startTime,
      endTime, type, meetingLink,
      description, maxStudents,
    } = data;

    if (!title?.trim())  throw Object.assign(new Error('عنوان الحصة مطلوب'),  { statusCode: 400 });
    if (!date)           throw Object.assign(new Error('التاريخ مطلوب'),       { statusCode: 400 });
    if (!startTime)      throw Object.assign(new Error('وقت البداية مطلوب'),   { statusCode: 400 });
    if (!endTime)        throw Object.assign(new Error('وقت النهاية مطلوب'),   { statusCode: 400 });

    // إذا كان في courseId، تحقق إنه للمدرس
    if (courseId) {
      const course = await prisma.course.findFirst({
        where: { id: courseId, teacherId: teacher.id },
      });
      if (!course) throw Object.assign(new Error('الكورس غير موجود'), { statusCode: 404 });
    }

    const schedule = await prisma.schedule.create({
      data: {
        teacherId:   teacher.id,
        courseId:    courseId || null,
        title:       title.trim(),
        description: description || null,
        date:        new Date(date),
        startTime,
        endTime,
        type:        type || 'online',
        meetingLink: meetingLink || null,
        maxStudents: maxStudents ? parseInt(maxStudents) : null,
      },
      include: {
        course: { select: { id: true, title: true } },
      },
    });

    const formatted = this._format(schedule);

    // إشعار الطلاب المسجلين في الكورس
    if (courseId) {
      try {
        const { getIO } = await import('../../socket/socket.config.js');
        const enrollments = await prisma.enrollment.findMany({
          where:   { courseId },
          include: { student: { select: { userId: true } } },
        });

        let io;
        try { io = getIO(); } catch (_) {}

        for (const e of enrollments) {
          // ✅ emit schedule:new so CourseDashboard updates sessions tab in realtime
          if (io) io.to(`user:${e.student.userId}`).emit('schedule:new', formatted);

          const notif = {
            userId: e.student.userId,
            type:   'schedule',
            title:  `📅 حصة جديدة: ${title}`,
            body:   `موعد الحصة: ${date} من ${startTime} إلى ${endTime}`,
            data:   { scheduleId: schedule.id },
          };
          await prisma.notification.create({ data: notif }).catch(() => {});
          if (io) io.to(`user:${e.student.userId}`).emit('notification:new', notif);
        }
      } catch (_) {}
    }

    return formatted;
  }

  // ── جلب حصص المدرس ───────────────────────────────────────────────────
  async getTeacherSchedules(userId, { upcoming = false } = {}) {
    const teacher = await this._getTeacher(userId);

    const where = { teacherId: teacher.id };
    if (upcoming) {
      where.date = { gte: new Date(new Date().toDateString()) };
    }

    const schedules = await prisma.schedule.findMany({
      where,
      include: { course: { select: { id: true, title: true } } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    return schedules.map(s => this._format(s));
  }

  // ── جلب الحصص القادمة (هذا الأسبوع) ─────────────────────────────────
  async getUpcomingSchedules(userId) {
    const teacher  = await this._getTeacher(userId);
    const today    = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const schedules = await prisma.schedule.findMany({
      where: {
        teacherId: teacher.id,
        date: { gte: today, lte: nextWeek },
      },
      include: { course: { select: { id: true, title: true } } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    return schedules.map(s => this._format(s));
  }

  // ── حذف حصة ──────────────────────────────────────────────────────────
  async deleteSchedule(scheduleId, userId) {
    const teacher  = await this._getTeacher(userId);
    const schedule = await prisma.schedule.findFirst({
      where: { id: scheduleId, teacherId: teacher.id },
    });
    if (!schedule) throw Object.assign(new Error('الحصة غير موجودة'), { statusCode: 404 });
    await prisma.schedule.delete({ where: { id: scheduleId } });
    return { message: 'تم حذف الحصة بنجاح' };
  }

  // ── تعديل حصة ────────────────────────────────────────────────────────
  async updateSchedule(scheduleId, userId, data) {
    const teacher  = await this._getTeacher(userId);
    const schedule = await prisma.schedule.findFirst({
      where: { id: scheduleId, teacherId: teacher.id },
    });
    if (!schedule) throw Object.assign(new Error('الحصة غير موجودة'), { statusCode: 404 });

    const updated = await prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        ...(data.title       && { title: data.title.trim() }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.date        && { date: new Date(data.date) }),
        ...(data.startTime   && { startTime: data.startTime }),
        ...(data.endTime     && { endTime: data.endTime }),
        ...(data.type        && { type: data.type }),
        ...(data.meetingLink !== undefined && { meetingLink: data.meetingLink }),
        ...(data.maxStudents !== undefined && { maxStudents: data.maxStudents ? parseInt(data.maxStudents) : null }),
      },
      include: { course: { select: { id: true, title: true } } },
    });

    return this._format(updated);
  }

  _format(s) {
    return {
      id:          s.id,
      teacherId:   s.teacherId,
      courseId:    s.courseId,
      courseTitle: s.course?.title || null,
      title:       s.title,
      description: s.description,
      date:        s.date,
      startTime:   s.startTime,
      endTime:     s.endTime,
      type:        s.type,
      meetingLink: s.meetingLink,
      maxStudents: s.maxStudents,
      createdAt:   s.createdAt,
    };
  }
}

export default new ScheduleService();