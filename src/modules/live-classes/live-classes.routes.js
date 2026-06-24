// backend/src/modules/live-classes/live-classes.routes.js

import express                from 'express';
import liveClassesController  from './live-classes.controller.js';
import { authMiddleware }     from '../auth/auth.middleware.js';
import prisma                 from '../../config/prisma.config.js';
import liveClassesService     from './live-classes.service.js';

const router = express.Router();

// كل الـ routes محمية
router.use(authMiddleware);

// ── Teacher routes ───────────────────────────────────────────────────────
router.post('/',                   (req, res) => liveClassesController.createRoom(req, res));
router.get('/',                    (req, res) => liveClassesController.getTeacherRooms(req, res));
router.get('/active',              (req, res) => liveClassesController.getActiveRoom(req, res));
router.get('/stats',               (req, res) => liveClassesController.getRoomStats(req, res));
router.get('/courses',             (req, res) => liveClassesController.getTeacherCourses(req, res));
router.get('/dashboard-stats',     (req, res) => liveClassesController.getDashboardStats(req, res));
router.patch('/:id/start',          (req, res) => liveClassesController.startRoom(req, res));
router.patch('/:id/end',           (req, res) => liveClassesController.endRoom(req, res));
router.delete('/:id',              (req, res) => liveClassesController.cancelRoom(req, res));


// ── Student: انضمام عبر كود ──────────────────────────────────────────────
router.get('/join/:code',          (req, res) => liveClassesController.joinRoomByCode(req, res));

// ── تفاصيل كورس ─────────────────────────────────────────────────────────
router.get('/course/:courseId/details', async (req, res) => {
  try {
    const details = await liveClassesService.getCourseDetails(
      req.params.courseId,
      req.user.userId,
    );
    res.json({ success: true, data: details });
  } catch (e) {
    res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
});

// ── جلب غرفة بالاسم ─────────────────────────────────────────────────────
router.get('/room/:roomName', async (req, res) => {
  try {
    const room = await prisma.webrtcRoom.findUnique({
      where:   { roomName: req.params.roomName },
      include: {
        course: { select: { id: true, title: true } },
        host:   { include: { user: { select: { name: true } } } },
        _count: { select: { participants: true } },
      },
    });
    if (!room) return res.status(404).json({ success: false, message: 'الغرفة غير موجودة' });
    res.json({
      success: true,
      data: {
        ...room,
        roomCode: room.roomName.slice(-6).toUpperCase(),
        roomLink: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/student/live-class?room=${room.roomName}`,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'فشل جلب معلومات الغرفة' });
  }
});

export default router;