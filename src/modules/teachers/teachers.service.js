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
      where: { linkedTeacherId: teacher.id },
    });
    return { hasAssistant: count > 0 };
  }
}

export default new TeachersService();
