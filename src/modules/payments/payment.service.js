// backend/src/modules/payments/payment.service.js

import prisma from '../../config/prisma.config.js';
import notificationsService from '../notifications/notifications.service.js';

class PaymentService {
  // ─────────────────────────────────────────────────────────────
  // إنشاء طلب دفع وتسجيله في قاعدة البيانات
  // ─────────────────────────────────────────────────────────────
  async processPayment({ userId, itemId, itemType, paymentMethod, promoCode, totalAmount }) {
    // 1. التحقق من وجود المستخدم وأنه student
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { student: true },
    });

    if (!user) {
      const err = new Error('المستخدم غير موجود');
      err.statusCode = 404;
      throw err;
    }

    if (user.role !== 'student') {
      const err = new Error('فقط الطلاب يمكنهم الشراء');
      err.statusCode = 403;
      throw err;
    }

    if (!user.student) {
      const err = new Error('لم يتم العثور على بيانات الطالب');
      err.statusCode = 404;
      throw err;
    }

    const studentId = user.student.id;

    // 2. معالجة الشراء حسب النوع
    if (itemType === 'course') {
      return await this._processCoursePayment({
        userId,
        studentId,
        courseId: itemId,
        paymentMethod,
        promoCode,
        totalAmount,
        user,
      });
    } else if (itemType === 'book') {
      return await this._processBookPayment({
        userId,
        studentId,
        bookId: itemId,
        paymentMethod,
        promoCode,
        totalAmount,
        user,
      });
    } else {
      const err = new Error('نوع المنتج غير صحيح');
      err.statusCode = 400;
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // شراء كورس
  // ─────────────────────────────────────────────────────────────
  async _processCoursePayment({ userId, studentId, courseId, paymentMethod, promoCode, totalAmount, user }) {
    // التحقق من وجود الكورس
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        teacher: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true, avatar: true, username: true },
            },
          },
        },
      },
    });

    if (!course) {
      const err = new Error('الكورس غير موجود');
      err.statusCode = 404;
      throw err;
    }

    if (!course.isPublished) {
      const err = new Error('هذا الكورس غير متاح حالياً');
      err.statusCode = 400;
      throw err;
    }

    // التحقق من عدم التسجيل المسبق
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
    });

    if (existingEnrollment) {
      const err = new Error('أنت مسجل في هذا الكورس بالفعل');
      err.statusCode = 409;
      throw err;
    }

    // تسجيل الطالب في الكورس داخل transaction
    const enrollment = await prisma.$transaction(async (tx) => {
      const newEnrollment = await tx.enrollment.create({
        data: { studentId, courseId, progress: 0 },
      });
      return newEnrollment;
    });

    // إشعار المدرس ببيانات الطالب كاملة
    await this._notifyTeacher({
      teacherUserId: course.teacher.userId,
      teacherName: course.teacher.user.name,
      studentUser: user,
      itemTitle: course.title,
      itemType: 'course',
      totalAmount,
      paymentMethod,
      promoCode,
    });

    return {
      success: true,
      orderId: `ORD-COURSE-${Date.now()}`,
      itemType: 'course',
      itemTitle: course.title,
      enrollmentId: enrollment.id,
      redirectPath: `/student/course/${courseId}`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // شراء كتاب
  // ─────────────────────────────────────────────────────────────
  async _processBookPayment({ userId, studentId, bookId, paymentMethod, promoCode, totalAmount, user }) {
    // التحقق من وجود الكتاب
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        teacher: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true, avatar: true, username: true },
            },
          },
        },
      },
    });

    if (!book) {
      const err = new Error('الكتاب غير موجود');
      err.statusCode = 404;
      throw err;
    }

    if (!book.isPublished) {
      const err = new Error('هذا الكتاب غير متاح حالياً');
      err.statusCode = 400;
      throw err;
    }

    // التحقق من عدم الشراء المسبق
    const existingPurchase = await prisma.bookPurchase.findUnique({
      where: { bookId_studentId: { bookId, studentId } },
    });

    if (existingPurchase) {
      const err = new Error('لقد اشتريت هذا الكتاب بالفعل');
      err.statusCode = 409;
      throw err;
    }

    // تسجيل عملية الشراء مع حساب العمولة
    const price      = book.price || 0;
    const platformCommission = parseFloat((price * 0.10).toFixed(2));
    const teacherEarning     = parseFloat((price * 0.90).toFixed(2));

    const purchase = await prisma.bookPurchase.create({
      data: { bookId, studentId, platformCommission, teacherEarning },
    });

    // إشعار المدرس ببيانات الطالب كاملة
    await this._notifyTeacher({
      teacherUserId: book.teacher.userId,
      teacherName: book.teacher.user.name,
      studentUser: user,
      itemTitle: book.title,
      itemType: 'book',
      totalAmount,
      paymentMethod,
      promoCode,
    });

    return {
      success: true,
      orderId: `ORD-BOOK-${Date.now()}`,
      itemType: 'book',
      itemTitle: book.title,
      purchaseId: purchase.id,
      redirectPath: `/student/books/${bookId}`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // إشعار المدرس ببيانات الطالب الكاملة
  // ─────────────────────────────────────────────────────────────
  async _notifyTeacher({ teacherUserId, teacherName, studentUser, itemTitle, itemType, totalAmount, paymentMethod, promoCode }) {
    const itemTypeLabel = itemType === 'course' ? 'الكورس' : 'الكتاب';
    const paymentMethodLabel = paymentMethod === 'card' ? 'بطاقة ائتمان' : 'فوري / محافظ إلكترونية';

    const notificationBody = [
      `🎉 طالب جديد اشترى ${itemTypeLabel}: "${itemTitle}"`,
      ``,
      `📋 بيانات الطالب:`,
      `• الاسم: ${studentUser.name || 'غير محدد'}`,
      `• البريد الإلكتروني: ${studentUser.email}`,
      `• رقم الهاتف: ${studentUser.phone || 'غير محدد'}`,
      `• اسم المستخدم: ${studentUser.username || 'غير محدد'}`,
      ``,
      `💳 تفاصيل الدفع:`,
      `• المبلغ المدفوع: ${totalAmount} جنيه`,
      `• طريقة الدفع: ${paymentMethodLabel}`,
      promoCode ? `• كود الخصم المستخدم: ${promoCode}` : null,
    ].filter(Boolean).join('\n');

    try {
      await notificationsService.create({
        userId: teacherUserId,
        type: 'new_purchase',
        title: `💰 عملية شراء جديدة - ${itemTitle}`,
        body: notificationBody,
        data: {
          itemType,
          itemTitle,
          totalAmount,
          paymentMethod: paymentMethodLabel,
          promoCode: promoCode || null,
          student: {
            id: studentUser.id,
            name: studentUser.name,
            email: studentUser.email,
            phone: studentUser.phone,
            username: studentUser.username,
            avatar: studentUser.avatar,
          },
        },
      });

      console.log(`✅ Teacher notified: ${teacherUserId} | Item: ${itemTitle}`);
    } catch (error) {
      // لا نوقف العملية لو الإشعار فشل
      console.error('⚠️ Failed to send teacher notification:', error.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // التحقق من صحة كود الخصم
  // ─────────────────────────────────────────────────────────────
  async validatePromoCode(code) {
    // يمكن لاحقاً ربطه بجدول promo_codes في قاعدة البيانات
    const validCodes = {
      'qemma2024': 20,
      'welcome10': 10,
      'save15':    15,
    };

    const upperCode = code?.toUpperCase();
    const lowerCode = code?.toLowerCase();

    const discount = validCodes[lowerCode] || validCodes[upperCode] || null;

    if (!discount) {
      const err = new Error('كود الخصم غير صحيح أو منتهي الصلاحية');
      err.statusCode = 400;
      throw err;
    }

    return { valid: true, discount, code };
  }

  // ─────────────────────────────────────────────────────────────
  // جلب بيانات المنتج (كورس أو كتاب)
  // ─────────────────────────────────────────────────────────────
  async getItemDetails(itemId, itemType) {
    if (itemType === 'course') {
      const course = await prisma.course.findUnique({
        where: { id: itemId },
        include: {
          teacher: {
            include: {
              user: { select: { id: true, name: true, email: true, avatar: true, username: true } },
            },
          },
          _count: { select: { enrollments: true, lessons: true } },
        },
      });

      if (!course) {
        const err = new Error('الكورس غير موجود');
        err.statusCode = 404;
        throw err;
      }

      return {
        id: course.id,
        title: course.title,
        description: course.description,
        price: course.price,
        thumbnail: course.thumbnail,
        subject: course.title,
        isPublished: course.isPublished,
        teacher: {
          id: course.teacher.user.id,
          name: course.teacher.user.name,
          avatar: course.teacher.user.avatar,
          username: course.teacher.user.username,
        },
        studentsCount: course._count.enrollments,
        lessonsCount: course._count.lessons,
      };
    } else if (itemType === 'book') {
      const book = await prisma.book.findUnique({
        where: { id: itemId },
        include: {
          teacher: {
            include: {
              user: { select: { id: true, name: true, email: true, avatar: true, username: true } },
            },
          },
        },
      });

      if (!book) {
        const err = new Error('الكتاب غير موجود');
        err.statusCode = 404;
        throw err;
      }

      return {
        id: book.id,
        title: book.title,
        description: book.description,
        price: book.price,
        thumbnail: book.coverImage,
        subject: book.subject,
        grade: book.grade,
        isPublished: book.isPublished,
        teacher: {
          id: book.teacher.user.id,
          name: book.teacher.user.name,
          avatar: book.teacher.user.avatar,
          username: book.teacher.user.username,
        },
      };
    }

    const err = new Error('نوع المنتج غير صحيح');
    err.statusCode = 400;
    throw err;
  }
}

export default new PaymentService();