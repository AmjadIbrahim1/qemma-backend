// backend/src/modules/live-classes/live-classes.controller.js

import liveClassesService from './live-classes.service.js';

const ok  = (res, data, status = 200) => res.status(status).json({ success: true,  data });
const err = (res, e)                  => res.status(e.statusCode || 500).json({ success: false, message: e.message });

class LiveClassesController {

  async createRoom(req, res) {
    try {
      const room = await liveClassesService.createRoom({
        teacherUserId: req.user.userId,
        ...req.body,
      });
      ok(res, room, 201);
    } catch (e) { err(res, e); }
  }

  async endRoom(req, res) {
    try {
      const result = await liveClassesService.endRoom(req.params.id, req.user.userId);
      ok(res, result);
    } catch (e) { err(res, e); }
  }

  async getTeacherRooms(req, res) {
    try {
      const { page = 1, limit = 10 } = req.query;
      const result = await liveClassesService.getTeacherRooms(req.user.userId, { page, limit });
      ok(res, result);
    } catch (e) { err(res, e); }
  }

  async getActiveRoom(req, res) {
    try {
      const room = await liveClassesService.getActiveRoom(req.user.userId);
      ok(res, room);
    } catch (e) { err(res, e); }
  }

  async getTeacherCourses(req, res) {
    try {
      const courses = await liveClassesService.getTeacherCourses(req.user.userId);
      ok(res, courses);
    } catch (e) { err(res, e); }
  }

  async getRoomStats(req, res) {
    try {
      const stats = await liveClassesService.getRoomStats(req.user.userId);
      ok(res, stats);
    } catch (e) { err(res, e); }
  }

  async joinRoomByCode(req, res) {
    try {
      const { code } = req.params;
      const result   = await liveClassesService.joinRoomByCode(code, req.user.userId);
      ok(res, result);
    } catch (e) { err(res, e); }
  }

  async getDashboardStats(req, res) {
    try {
      const stats = await liveClassesService.getDashboardStats(req.user.userId);
      ok(res, stats);
    } catch (e) { err(res, e); }
  }

  async startRoom(req, res) {
    try {
      const result = await liveClassesService.startRoom(req.params.id, req.user.userId);
      ok(res, result);
    } catch (e) { err(res, e); }
  }

  async cancelRoom(req, res) {
    try {
      const result = await liveClassesService.cancelRoom(req.params.id, req.user.userId);
      ok(res, result);
    } catch (e) { err(res, e); }
  }

  async getRoomByName(req, res) {
    try {
      const { roomName } = req.params;
      const { prisma }   = await import('../../config/prisma.config.js');
      const room = await prisma.default.webrtcRoom.findUnique({
        where:   { roomName },
        include: {
          course: { select: { id: true, title: true } },
          host:   { include: { user: { select: { name: true } } } },
          _count: { select: { participants: true } },
        },
      });
      if (!room) return res.status(404).json({ success: false, message: 'الغرفة غير موجودة' });
      ok(res, { ...room, roomCode: room.roomName.slice(-6).toUpperCase() });
    } catch (e) { err(res, e); }
  }
}

export default new LiveClassesController();