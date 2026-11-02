import prisma from '../../config/prisma.config.js';

class TeachersService {

  async getProfile(userId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId },
      include: { user: { select: { name: true, avatar: true, email: true } } },
    });
    if (!teacher) throw Object.assign(new Error('المدرس غير موجود'), { statusCode: 404 });
    return {
      id: teacher.id,
      userId: teacher.userId,
      name: teacher.user?.name ?? null,
      email: teacher.user?.email ?? null,
      avatar: teacher.user?.avatar ?? null,
      bio: teacher.bio,
      expertise: teacher.expertise,
      specialties: teacher.specialties,
      stream: teacher.stream,
      verified: teacher.verified,
      ratingAvg: teacher.ratingAvg,
      linkedTeacherId: teacher.linkedTeacherId,
      isActivated: teacher.isActivated,
      createdAt: teacher.createdAt,
      updatedAt: teacher.updatedAt,
    };
  }

  async hasAssistant(userId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!teacher) throw Object.assign(new Error('المدرس غير موجود'), { statusCode: 404 });
    const count = await prisma.teacher.count({
      where: { linkedTeacherId: teacher.id, isActivated: true },
    });
    return { hasAssistant: count > 0 };
  }

  /**
   * GET - Get all assistant teachers linked to the current teacher
   */
  async getAssistants(userId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!teacher) throw Object.assign(new Error('المدرس غير موجود'), { statusCode: 404 });

    const assistants = await prisma.teacher.findMany({
      where: { linkedTeacherId: teacher.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            username: true,
            phone: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return assistants.map(a => ({
      id: a.id,
      userId: a.userId,
      name: a.user.name || '',
      email: a.user.email || '',
      avatar: a.user.avatar || null,
      username: a.user.username || '',
      phone: a.user.phone || '',
      specialties: a.specialties,
      stream: a.stream,
      isActivated: a.isActivated,
      linkedAt: a.createdAt,
      registeredAt: a.user.createdAt,
    }));
  }

  /**
   * POST - Create a Stripe Checkout Session for activating an assistant teacher.
   * The teacher is redirected to a dedicated Stripe payment page (card-only).
   */
  async createActivationCheckoutSession(teacherUserId, assistantTeacherId, originUrl) {
    const ACTIVATION_FEE_EGP = 500; // 500 EGP

    // Verify the main teacher exists
    const mainTeacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
      select: { id: true },
    });
    if (!mainTeacher) throw Object.assign(new Error('المدرس غير موجود'), { statusCode: 404 });

    // Verify the assistant teacher exists and is linked to this teacher
    const assistant = await prisma.teacher.findUnique({
      where: { id: assistantTeacherId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!assistant) throw Object.assign(new Error('المدرس المساعد غير موجود'), { statusCode: 404 });
    if (assistant.linkedTeacherId !== mainTeacher.id) {
      throw Object.assign(new Error('هذا المدرس المساعد غير مرتبط بحسابك'), { statusCode: 403 });
    }
    if (assistant.isActivated) {
      throw Object.assign(new Error('هذا المدرس المساعد مفعل بالفعل'), { statusCode: 400 });
    }

    const successUrl = `${originUrl}/teacher/assistant-teachers?activation_success=${assistant.id}`;
    const cancelUrl  = `${originUrl}/teacher/assistant-teachers`;

    // Create Stripe Checkout Session (card-only via payment_method_types)
    const stripe = await this._getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'], // credit/debit cards only
      line_items: [{
        price_data: {
          currency: 'egp',
          product_data: {
            name: `تفعيل المدرس المساعد: ${assistant.user.name || assistant.user.email}`,
            description: 'تفعيل حساب المدرس المساعد - صلاحية وصول كاملة',
          },
          unit_amount: ACTIVATION_FEE_EGP * 100, // convert to piasters
        },
        quantity: 1,
      }],
      metadata: {
        type: 'assistant_activation',
        assistantTeacherId: assistant.id,
        mainTeacherId: mainTeacher.id,
        mainTeacherUserId: teacherUserId,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return {
      sessionUrl: session.url,
      sessionId: session.id,
    };
  }

  /**
   * POST - Confirm activation after successful Stripe payment (called via webhook or success page)
   */
  async confirmActivation(assistantTeacherId) {
    const assistant = await prisma.teacher.update({
      where: { id: assistantTeacherId },
      data: { isActivated: true },
    });
    return { isActivated: true, assistantId: assistant.id };
  }

  /**
   * GET - Stripe publishable key for frontend
   */
  getStripePublishableKey() {
    return process.env.STRIPE_PUBLISHABLE_KEY || '';
  }

  /**
   * Helper: get Stripe instance
   */
  async _getStripe() {
    const Stripe = (await import('stripe')).default;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw Object.assign(new Error('Stripe غير مهيأ. يرجى ضبط مفتاح STRIPE_SECRET_KEY في ملف .env'), { statusCode: 500 });
    }
    return new Stripe(stripeKey);
  }
}

export default new TeachersService();
