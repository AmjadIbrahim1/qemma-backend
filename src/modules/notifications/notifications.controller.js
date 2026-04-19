// backend/src/modules/notifications/notifications.controller.js

import notificationsService from './notifications.service.js';

class NotificationsController {

  // ── Teacher send notification ─────────────────────────────────
  async sendNotification(req, res, next) {
    try {
      const { type, title, message, recipient, courseId, studentId, scheduleType } = req.body;

      if (!title?.trim()) return res.status(400).json({ success: false, message: 'العنوان مطلوب' });
      if (!message?.trim()) return res.status(400).json({ success: false, message: 'النص مطلوب' });

      const data = { senderUserId: req.user.userId, type, scheduleType };
      let result;

      if (recipient === 'all') {
        result = await notificationsService.sendToAllStudents({
          teacherId: req.user.userId, type, title, body: message, data,
        });
      } else if (recipient === 'course') {
        if (!courseId) return res.status(400).json({ success: false, message: 'يرجى اختيار الكورس' });
        result = await notificationsService.sendToCourse({
          courseId, type, title, body: message, data,
        });
      } else if (recipient === 'student') {
        if (!studentId) return res.status(400).json({ success: false, message: 'يرجى اختيار الطالب' });
        result = await notificationsService.sendToStudent({
          studentId, type, title, body: message, data,
        });
      } else {
        return res.status(400).json({ success: false, message: 'المستقبل غير صحيح' });
      }

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ── Get teacher's courses for dropdown ────────────────────────
  async getTeacherCourses(req, res, next) {
    try {
      const courses = await notificationsService.getTeacherCourses(req.user.userId);
      res.status(200).json({ success: true, data: courses });
    } catch (error) {
      next(error);
    }
  }

  // ── Get teacher's students for dropdown ───────────────────────
  async getTeacherStudents(req, res, next) {
    try {
      const students = await notificationsService.getTeacherStudents(req.user.userId);
      res.status(200).json({ success: true, data: students });
    } catch (error) {
      next(error);
    }
  }

  // ── Get my notifications ──────────────────────────────────────
  async getMyNotifications(req, res, next) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await notificationsService.getForUser(req.user.userId, {
        page: parseInt(page), limit: parseInt(limit),
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getUnreadCount(req, res, next) {
    try {
      const count = await notificationsService.getUnreadCount(req.user.userId);
      res.status(200).json({ success: true, data: { unreadCount: count } });
    } catch (error) {
      next(error);
    }
  }

  async markAsRead(req, res, next) {
    try {
      const notification = await notificationsService.markAsRead(req.params.id, req.user.userId);
      res.status(200).json({ success: true, data: notification });
    } catch (error) {
      next(error);
    }
  }

  async markAllAsRead(req, res, next) {
    try {
      const result = await notificationsService.markAllAsRead(req.user.userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteOne(req, res, next) {
    try {
      const result = await notificationsService.delete(req.params.id, req.user.userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteAll(req, res, next) {
    try {
      const result = await notificationsService.deleteAll(req.user.userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export default new NotificationsController();