import { Router } from 'express';
import multer from 'multer';
import webrtcController from './webrtc.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/', 'application/octet-stream'];
    const isAllowed = allowed.some(type => file.mimetype.startsWith(type));
    if (!isAllowed) return cb(new Error('Only video files are allowed'));
    cb(null, true);
  },
});

router.use(authMiddleware);

router.post('/recording/upload', upload.single('video'), (req, res) => webrtcController.uploadRecording(req, res));

router.get('/test', (req, res) => {
  res.json({ status: 'WebRTC route working!' });
});

export default router;
