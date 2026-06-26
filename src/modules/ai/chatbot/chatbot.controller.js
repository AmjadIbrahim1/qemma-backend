// backend/src/modules/ai/chatbot/chatbot.controller.js

import chatbotService from './chatbot.service.js';

class ChatbotController {
  async sendMessage(req, res, next) {
    try {
      const { message, history } = req.body;
      const { userId, role } = req.user;

      if (!message || !message.trim()) {
        return res.status(400).json({
          success: false,
          message: 'الرجاء إدخال رسالة',
        });
      }

      const limitInfo = await chatbotService.checkUsageLimit(userId, role);
      if (!limitInfo.allowed) {
        return res.status(429).json({
          success: false,
          message: `لقد استنفدت حد الرسائل المسموح به (${limitInfo.limit} رسالة). ${role === 'student' ? 'قم بشراء كورس أو كتاب لزيادة الحد إلى 50 رسالة.' : 'قم بإنشاء كورس لزيادة الحد إلى 50 رسالة.'}`,
          data: { remaining: 0, limit: limitInfo.limit, used: limitInfo.used },
        });
      }

      const result = await chatbotService.sendMessage(userId, role, message.trim(), history || []);

      await chatbotService.incrementUsage(userId);

      const updatedLimit = await chatbotService.checkUsageLimit(userId, role);

      res.status(200).json({
        success: true,
        data: {
          reply: result.reply,
          usage: result.usage,
          limit: updatedLimit,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new ChatbotController();
