// backend/src/modules/live-classes/live-classes.routes.js

import express from 'express';
import liveClassesController from './live-classes.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';
import prisma from '../../config/prisma.config.js';
import liveClassesService from './live-classes.service.js';

const router = express.Router();
router.use(authMiddleware);

router.post('/',              liveClassesController.createRoom);
router.get('/',               liveClassesController.getTeacherRooms);
router.get('/active',         liveClassesController.getActiveRoom);
router.get('/stats',          liveClassesController.getRoomStats);
router.get('/courses',        liveClassesController.getTeacherCourses);
router.patch('/:id/end',      liveClassesController.endRoom);

// GET /api/live-classes/course/:courseId/details
router.get('/course/:courseId/details', async (req, res) => {
  try {
    const details = await liveClassesService.getCourseDetails(
      req.params.courseId,
      req.user.userId,
    );
    return res.json({ success: true, data: details });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

// GET /api/live-classes/room/:roomName
router.get('/room/:roomName', async (req, res) => {
  const { roomName } = req.params;
  try {
    const room = await prisma.webrtcRoom.findUnique({
      where: { roomName },
      include: {
        course:  { select: { id: true, title: true } },
        host:    { include: { user: { select: { name: true } } } },
        _count:  { select: { participants: true } },
      },
    });

    if (!room) {
      return res.status(404).json({ success: false, message: 'الغرفة غير موجودة' });
    }

    const roomCode = room.roomName.slice(-6).toUpperCase();

    return res.json({
      success: true,
      data: {
        ...room,
        roomCode,
        roomLink: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/student/live-class?room=${room.roomName}`,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'فشل جلب معلومات الغرفة' });
  }
});

export default router;