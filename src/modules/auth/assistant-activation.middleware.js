// backend/src/modules/auth/assistant-activation.middleware.js
// ✅ NEW: Middleware that blocks inactive (unactivated) assistant teachers from accessing any routes.
// An assistant teacher must be activated by the main teacher via payment before they can use the system.

import prisma from '../../config/prisma.config.js';

/**
 * Middleware: requireActivatedAssistant
 * Checks if the authenticated user is an assistant_teacher with isActivated = true.
 * If the user is NOT an assistant_teacher, they pass through (this middleware only applies to assistants).
 * If the user IS an assistant_teacher but is NOT activated, they get a 403 error.
 */
export const requireActivatedAssistant = async (req, res, next) => {
  try {
    // Only check for assistant_teacher role
    if (req.user.role !== 'assistant_teacher') {
      return next();
    }

    const teacher = await prisma.teacher.findUnique({
      where: { userId: req.user.userId },
      select: { isActivated: true, linkedTeacherId: true },
    });

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'لم يتم العثور على بيانات المدرس المساعد',
      });
    }

    if (!teacher.linkedTeacherId) {
      return res.status(403).json({
        success: false,
        message: 'حساب المدرس المساعد غير مرتبط بمدرس رئيسي',
      });
    }

    if (!teacher.isActivated) {
      return res.status(403).json({
        success: false,
        message: 'المدرس المساعد غير مفعل. يرجى التواصل مع المدرس الرئيسي لتفعيل حسابك.',
      });
    }

    next();
  } catch (error) {
    console.error('❌ Assistant activation check error:', error);
    return res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء التحقق من صلاحية المدرس المساعد',
    });
  }
};
