// backend/src/modules/ai/chatbot/chatbot.service.js

import OpenAI from 'openai';
import prisma from '../../../config/prisma.config.js';
import { STUDENT_ASSISTANT_SYSTEM } from './prompts/student-assistant.prompt.js';
import { TEACHER_ASSISTANT_SYSTEM } from './prompts/tutor.prompt.js';

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const MAX_HISTORY = 20;

const ROLE_PROMPTS = {
  student: STUDENT_ASSISTANT_SYSTEM,
  teacher: TEACHER_ASSISTANT_SYSTEM,
  assistant_teacher: TEACHER_ASSISTANT_SYSTEM,
};

const ROLE_API_KEYS = {
  student: process.env.GROQ_STUDENT_API_KEY,
  teacher: process.env.GROQ_TEACHER_API_KEY,
  assistant_teacher: process.env.GROQ_TEACHER_API_KEY,
};

function createGroqClient(role) {
  const apiKey = ROLE_API_KEYS[role];
  if (!apiKey) {
    throw new Error(`AI assistant is not configured for role: ${role}`);
  }
  return new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
}

class ChatbotService {
  async _getUsageLimit(userId, role) {
    if (role === 'student') {
      const student = await prisma.student.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!student) return 0;

      const [enrollmentsCount, bookPurchasesCount] = await Promise.all([
        prisma.enrollment.count({ where: { studentId: student.id } }),
        prisma.bookPurchase.count({ where: { studentId: student.id } }),
      ]);

      return enrollmentsCount > 0 || bookPurchasesCount > 0 ? 50 : 10;
    }

    if (role === 'teacher' || role === 'assistant_teacher') {
      const teacher = await prisma.teacher.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!teacher) return 0;

      const coursesCount = await prisma.course.count({
        where: { teacherId: teacher.id },
      });

      return coursesCount > 0 ? 50 : 10;
    }

    return 0;
  }

  async checkUsageLimit(userId, role) {
    const limit = await this._getUsageLimit(userId, role);
    if (limit === 0) return { allowed: false, remaining: 0, limit: 0 };

    const usage = await prisma.aiAssistantUsage.findUnique({
      where: { userId },
    });

    const used = usage?.messagesCount || 0;
    const remaining = Math.max(0, limit - used);

    return {
      allowed: remaining > 0,
      remaining,
      limit,
      used,
    };
  }

  async incrementUsage(userId) {
    await prisma.aiAssistantUsage.upsert({
      where: { userId },
      update: { messagesCount: { increment: 1 } },
      create: { userId, messagesCount: 1 },
    });
  }

  async sendMessage(userId, role, message, history = []) {
    const systemPrompt = ROLE_PROMPTS[role] || STUDENT_ASSISTANT_SYSTEM;
    const client = createGroqClient(role);

    const recentHistory = history.slice(-MAX_HISTORY);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: message },
    ];

    try {
      const completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        temperature: 0.7,
        max_tokens: 2000,
        messages,
      });

      const reply = completion?.choices?.[0]?.message?.content || '';
      return { reply, usage: completion?.usage || null };
    } catch (error) {
      console.error('❌ Chatbot Groq error:', error.message);
      throw new Error(error.message || 'فشل الاتصال بالمساعد الذكي');
    }
  }
}

export default new ChatbotService();
