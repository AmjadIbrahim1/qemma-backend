// backend/src/modules/ai/chatbot/chatbot.routes.js

import { Router } from 'express';
import chatbotController from './chatbot.controller.js';
import chatbotService from './chatbot.service.js';
import { authMiddleware } from '../../auth/auth.middleware.js';

const router = Router();

router.post('/message', authMiddleware, chatbotController.sendMessage);

router.get('/usage', authMiddleware, async (req, res, next) => {
  try {
    const limit = await chatbotService.checkUsageLimit(req.user.userId, req.user.role);
    res.json({ success: true, data: limit });
  } catch (error) {
    next(error);
  }
});

export default router;
