// backend/src/modules/live-classes/live-classes.controller.js

import liveClassesService from './live-classes.service.js';

class LiveClassesController {

  async createRoom(req, res, next) {
    try {
      const room = await liveClassesService.createRoom({
        teacherUserId: req.user.userId,
        ...req.body,
      });
      res.status(201).json({ success: true, data: room });
    } catch (error) {
      next(error);
    }
  }

  async endRoom(req, res, next) {
    try {
      const result = await liveClassesService.endRoom(
        req.params.id,
        req.user.userId,
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getTeacherRooms(req, res, next) {
    try {
      const { page = 1, limit = 10 } = req.query;
      const result = await liveClassesService.getTeacherRooms(
        req.user.userId,
        { page, limit },
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getActiveRoom(req, res, next) {
    try {
      const room = await liveClassesService.getActiveRoom(req.user.userId);
      res.status(200).json({ success: true, data: room });
    } catch (error) {
      next(error);
    }
  }

  async getTeacherCourses(req, res, next) {
    try {
      const courses = await liveClassesService.getTeacherCourses(req.user.userId);
      res.status(200).json({ success: true, data: courses });
    } catch (error) {
      next(error);
    }
  }

  async getRoomStats(req, res, next) {
    try {
      const stats = await liveClassesService.getRoomStats(req.user.userId);
      res.status(200).json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  }
}

export default new LiveClassesController();