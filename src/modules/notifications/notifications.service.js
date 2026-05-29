// backend/src/modules/notifications/notifications.service.js

import prisma from '../../config/prisma.config.js';
import { getIO } from '../../socket/socket.config.js';

class NotificationsService {

  // ─────────────────────────────────────────────────────────────
  // Create a notification for a user + push via socket
  // ─────────────────────────────────────────────────────────────
  async create({ userId, type, title, body, data = null }) {
    const notification = await prisma.notification.create({
      data: { userId, type, title, body, data: data ?? undefined },
    });

    // Push real-time to the user's private room
    try {
      const io = getIO();
      io.to(`user:${userId}`).emit('notification:new', notification);
    } catch (_) {}

    return notification;
  }

  // ─────────────────────────────────────────────────────────────
  // Send notification to all students in a course
  // ─────────────────────────────────────────────────────────────
  async sendToCourse({ courseId, type, title, body, data = null }) {
    const enrollments = await prisma.enrollment.findMany({
      where: { courseId },
      include: { student: { select: { userId: true } } },
    });

    const results = await Promise.allSettled(
      enrollments.map(e =>
        this.create({ userId: e.student.userId, type, title, body, data })
      )
    );

    return { sent: results.filter(r => r.status === 'fulfilled').length };
  }

  // ─────────────────────────────────────────────────────────────
  // Send notification to all students of a teacher
  // ─────────────────────────────────────────────────────────────
  async sendToAllStudents({ teacherId, type, title, body, data = null }) {
    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherId } });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });

    const enrollments = await prisma.enrollment.findMany({
      where: { course: { teacherId: teacher.id } },
      include: { student: { select: { userId: true } } },
      distinct: ['studentId'],
    });

    const results = await Promise.allSettled(
      enrollments.map(e =>
        this.create({ userId: e.student.userId, type, title, body, data })
      )
    );

    return { sent: results.filter(r => r.status === 'fulfilled').length };
  }

  // ─────────────────────────────────────────────────────────────
  // Send to specific student
  // ─────────────────────────────────────────────────────────────
  async sendToStudent({ studentId, type, title, body, data = null }) {
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
    return this.create({ userId: student.userId, type, title, body, data });
  }

  // ─────────────────────────────────────────────────────────────
  // Get teacher's courses (for notification form dropdown)
  // ─────────────────────────────────────────────────────────────
  async getTeacherCourses(teacherId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherId } });
    if (!teacher) return [];
    return prisma.course.findMany({
      where: { teacherId: teacher.id },
      select: { id: true, title: true, _count: { select: { enrollments: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Get teacher's students list (for single-student notifications)
  // ─────────────────────────────────────────────────────────────
  async getTeacherStudents(teacherId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherId } });
    if (!teacher) return [];

    const enrollments = await prisma.enrollment.findMany({
      where: { course: { teacherId: teacher.id } },
      include: {
        student: { include: { user: { select: { id: true, name: true, avatar: true } } } },
      },
      distinct: ['studentId'],
    });

    return enrollments.map(e => ({
      studentId: e.student.id,
      userId:    e.student.userId,
      name:      e.student.user?.name ?? 'مجهول',
      avatar:    e.student.user?.avatar,
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Get notification history sent by a teacher
  // ─────────────────────────────────────────────────────────────
  async getTeacherNotificationHistory(teacherUserId, { page = 1, limit = 20 } = {}) {
    const skip = (page - 1) * limit;

    // We track sent notifications via a simple query:
    // notifications where sender data contains the teacherUserId
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: {
          data: {
            path: ['senderUserId'],
            equals: teacherUserId,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        include: { user: { select: { name: true } } },
      }),
      prisma.notification.count({
        where: {
          data: { path: ['senderUserId'], equals: teacherUserId },
        },
      }),
    ]);

    return {
      notifications,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Get all notifications for a user (newest first)
  // ─────────────────────────────────────────────────────────────
  async getForUser(userId, { page = 1, limit = 20, courseId } = {}) {
    const skip = (page - 1) * limit;
    // Base where: userId only
    const whereBase = { userId };
    // If courseId provided, filter by data.courseId (JSON field in PostgreSQL)
    if (courseId) {
      whereBase.data = { path: ['courseId'], equals: courseId };
    }
    const whereUnread = { ...whereBase, isRead: false };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: whereBase,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: whereBase }),
      prisma.notification.count({ where: whereUnread }),
    ]);

    return {
      notifications,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      unreadCount,
    };
  }

  async getUnreadCount(userId) {
    return prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markAsRead(notificationId, userId) {
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) throw Object.assign(new Error('Notification not found'), { statusCode: 404 });
    return prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } });
  }

  async markAllAsRead(userId) {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: result.count };
  }

  async delete(notificationId, userId) {
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) throw Object.assign(new Error('Notification not found'), { statusCode: 404 });
    await prisma.notification.delete({ where: { id: notificationId } });
    return { deleted: true };
  }

  async deleteAll(userId) {
    const result = await prisma.notification.deleteMany({ where: { userId } });
    return { deleted: result.count };
  }
}

export default new NotificationsService();