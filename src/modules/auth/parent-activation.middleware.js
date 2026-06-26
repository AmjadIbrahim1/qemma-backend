// backend/src/modules/auth/parent-activation.middleware.js
// ✅ NEW: Middleware that blocks inactive (unactivated) parents from accessing any routes.
// A parent must be activated by the student via payment before they can view student data.

import prisma from '../../config/prisma.config.js';

/**
 * Middleware: requireActivatedParent
 * Checks if the authenticated user is a parent with isActivated = true.
 * If the user is NOT a parent, they pass through.
 * If the user IS a parent but is NOT activated, they get a 403 error.
 */
export const requireActivatedParent = async (req, res, next) => {
  try {
    // Only check for parent role
    if (req.user.role !== 'parent') {
      return next();
    }

    const parent = await prisma.parent.findUnique({
      where: { userId: req.user.userId },
      select: {
        isActivated: true,
        _count: { select: { studentLinks: true } },
      },
    });

    if (!parent) {
      return res.status(404).json({
        success: false,
        message: 'لم يتم العثور على بيانات ولي الأمر',
      });
    }

    if (parent._count.studentLinks === 0) {
      return res.status(403).json({
        success: false,
        message: 'حساب ولي الأمر غير مرتبط بأي طالب',
      });
    }

    if (!parent.isActivated) {
      return res.status(403).json({
        success: false,
        message: 'ولي الأمر غير مفعل. يرجى التواصل مع الطالب لتفعيل حسابك.',
      });
    }

    next();
  } catch (error) {
    console.error('❌ Parent activation check error:', error);
    return res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء التحقق من صلاحية ولي الأمر',
    });
  }
};
