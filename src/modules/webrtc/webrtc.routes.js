// backend/src/modules/webrtc/webrtc.routes.js
import { Router } from 'express';

const router = Router();

router.get('/test', (req, res) => {
  res.json({ status: 'WebRTC route working!' });
});

export default router;
