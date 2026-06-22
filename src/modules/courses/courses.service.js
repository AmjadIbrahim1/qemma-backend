// backend/src/modules/courses/courses.service.js
// التصنيف (category) يأتي من الـ Frontend مباشرةً (= مادة المدرس)
// إذا لم يُرسل، نأخذه من specialties المدرس في الـ Database

import prisma from '../../config/prisma.config.js';

class CoursesService {

  // ── Get teacher record ────────────────────────────────────────
  async _getTeacher(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) {
      throw Object.assign(new Error('Teacher profile not found'), { statusCode: 403 });
    }
    return teacher;
  }

  // ── CREATE course ─────────────────────────────────────────────
  async createCourse(userId, data) {
    const teacher = await this._getTeacher(userId);

    const {
      title, description, level,
      price, duration, maxStudents, startDate, endDate,
      prerequisites, isPublished,
      thumbnailBase64,
    } = data;

    // التصنيف = ما أرسله الـ Frontend (مادة المدرس)
    // fallback: أول specialty في بيانات المدرس
    const category =
      teacher.specialties?.[0] ||
      teacher.expertise ||
      '';

    if (!title?.trim())       throw Object.assign(new Error('عنوان الكورس مطلوب'),       { statusCode: 400 });
    if (!description?.trim()) throw Object.assign(new Error('وصف الكورس مطلوب'),         { statusCode: 400 });
    if (!level?.trim())       throw Object.assign(new Error('المستوى مطلوب'),             { statusCode: 400 });
    if (price === undefined || price === '') throw Object.assign(new Error('السعر مطلوب'), { statusCode: 400 });
    if (!startDate)           throw Object.assign(new Error('تاريخ البداية مطلوب'),       { statusCode: 400 });

    let prereqArray = [];
    if (prerequisites) {
      try { prereqArray = typeof prerequisites === 'string' ? JSON.parse(prerequisites) : prerequisites; }
      catch { prereqArray = []; }
    }

    const numericPrice = parseFloat(price) || 0;

    const course = await prisma.course.create({
      data: {
        teacherId:      teacher.id,
        title:          title.trim(),
        thumbnail:      thumbnailBase64 || null,
        price:          numericPrice,
        platformFee:    +(numericPrice * 0.20).toFixed(2),
        teacherEarning: +(numericPrice * 0.80).toFixed(2),
        isPublished:    isPublished === 'true' || isPublished === true || false,
        description: JSON.stringify({
          text:          description.trim(),
          category,
          level,
          duration:      duration    ? parseInt(duration)    : null,
          maxStudents:   maxStudents ? parseInt(maxStudents) : null,
          startDate:     startDate   || null,
          endDate:       endDate     || null,
          prerequisites: prereqArray,
        }),
      },
      include: {
        teacher: { include: { user: { select: { name: true, avatar: true } } } },
      },
    });

    return this._format(course);
  }

  // ── LIST teacher's own courses ────────────────────────────────
  async getTeacherCourses(userId) {
    const teacher = await this._getTeacher(userId);

    const courses = await prisma.course.findMany({
      where:   { teacherId: teacher.id },
      include: {
        _count:  { select: { enrollments: true, lessons: true } },
        teacher: { include: { user: { select: { name: true, avatar: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return courses.map(c => this._format(c));
  }

  // ── LIST public (published) courses ──────────────────────────
  async getPublishedCourses({ subject, level, search, page = 1, limit = 50 } = {}) {
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const where = { isPublished: true };
    if (search) where.title = { contains: search, mode: 'insensitive' };

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          _count:  { select: { enrollments: true, lessons: true } },
          teacher: { include: { user: { select: { id: true, name: true, avatar: true } } } },
        },
      }),
      prisma.course.count({ where }),
    ]);

    let formatted = courses.map(c => this._format(c));
    if (level)   formatted = formatted.filter(c => c.level    === level);
    if (subject) formatted = formatted.filter(c => c.category === subject);

    return {
      courses: formatted,
      pagination: {
        page: parseInt(page), limit: parseInt(limit),
        total, totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  // ── GET single course ─────────────────────────────────────────
  async getCourse(courseId, userId) {
    const course = await prisma.course.findUnique({
      where:   { id: courseId },
      include: {
        _count:  { select: { enrollments: true, lessons: true } },
        lessons: { orderBy: { order: 'asc' }, select: { id: true, title: true, order: true, isPublished: true } },
        teacher: { include: { user: { select: { id: true, name: true, avatar: true } } } },
      },
    });

    if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 });

    if (!course.isPublished && course.teacher.user.id !== userId) {
      throw Object.assign(new Error('Course not found'), { statusCode: 404 });
    }

    return this._format(course);
  }

  // ── UPDATE course ─────────────────────────────────────────────
  async updateCourse(courseId, userId, data) {
    const teacher = await this._getTeacher(userId);

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.teacherId !== teacher.id) {
      throw Object.assign(new Error('Course not found or unauthorized'), { statusCode: 404 });
    }

    const {
      title, description, level,
      price, duration, maxStudents, startDate, endDate,
      prerequisites, isPublished, thumbnailBase64,
    } = data;

    const category =
      teacher.specialties?.[0] ||
      teacher.expertise ||
      '';

    let prereqArray = [];
    if (prerequisites) {
      try { prereqArray = typeof prerequisites === 'string' ? JSON.parse(prerequisites) : prerequisites; }
      catch { prereqArray = []; }
    }

    let oldMeta = {};
    try { oldMeta = JSON.parse(course.description || '{}'); } catch { oldMeta = { text: course.description }; }

    const newMeta = {
      text:          description?.trim()  ?? oldMeta.text,
      category:      category             || oldMeta.category,
      level:         level                ?? oldMeta.level,
      duration:      duration    !== undefined ? parseInt(duration)    : oldMeta.duration,
      maxStudents:   maxStudents !== undefined ? parseInt(maxStudents) : oldMeta.maxStudents,
      startDate:     startDate   ?? oldMeta.startDate,
      endDate:       endDate     ?? oldMeta.endDate,
      prerequisites: prerequisites !== undefined ? prereqArray : (oldMeta.prerequisites ?? []),
    };

    const newThumbnail = thumbnailBase64 !== undefined
      ? (thumbnailBase64 || null)
      : course.thumbnail;

    const updatedPrice = price !== undefined ? parseFloat(price) || 0 : undefined;

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        ...(title       && { title: title.trim() }),
        ...(updatedPrice !== undefined && {
          price:          updatedPrice,
          platformFee:    +(updatedPrice * 0.20).toFixed(2),
          teacherEarning: +(updatedPrice * 0.80).toFixed(2),
        }),
        ...(isPublished !== undefined && { isPublished: isPublished === 'true' || isPublished === true }),
        thumbnail:   newThumbnail,
        description: JSON.stringify(newMeta),
      },
      include: {
        _count:  { select: { enrollments: true, lessons: true } },
        teacher: { include: { user: { select: { name: true, avatar: true } } } },
      },
    });

    return this._format(updated);
  }

  // ── DELETE course ─────────────────────────────────────────────
  async deleteCourse(courseId, userId) {
    const teacher = await this._getTeacher(userId);
    const course  = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.teacherId !== teacher.id) {
      throw Object.assign(new Error('Course not found or unauthorized'), { statusCode: 404 });
    }
    await prisma.course.delete({ where: { id: courseId } });
    return { message: 'Course deleted successfully' };
  }

  // ── Toggle publish ────────────────────────────────────────────
  async togglePublish(courseId, userId) {
    const teacher = await this._getTeacher(userId);
    const course  = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.teacherId !== teacher.id) {
      throw Object.assign(new Error('Course not found or unauthorized'), { statusCode: 404 });
    }
    const updated = await prisma.course.update({
      where: { id: courseId },
      data:  { isPublished: !course.isPublished },
    });
    return { isPublished: updated.isPublished };
  }

  // ── GET teacher profile by Teacher.id ────────────────────────
  async getTeacherProfile(teacherId) {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      include: {
        user:    { select: { id: true, name: true, avatar: true, email: true, phone: true, createdAt: true } },
        courses: { where: { isPublished: true }, include: { _count: { select: { enrollments: true, lessons: true } } }, orderBy: { createdAt: 'desc' } },
        books:   { where: { isPublished: true }, include: { _count: { select: { purchases: true } } }, orderBy: { createdAt: 'desc' } },
        _count:  { select: { courses: true, books: true } },
      },
    });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });
    return this._formatTeacherProfile(teacher);
  }

  // ── GET teacher profile by User.id ───────────────────────────
  async getTeacherProfileByUserId(userId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId },
      include: {
        user:    { select: { id: true, name: true, avatar: true, email: true, phone: true, createdAt: true } },
        courses: { where: { isPublished: true }, include: { _count: { select: { enrollments: true, lessons: true } } }, orderBy: { createdAt: 'desc' } },
        books:   { where: { isPublished: true }, include: { _count: { select: { purchases: true } } }, orderBy: { createdAt: 'desc' } },
        _count:  { select: { courses: true, books: true } },
      },
    });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });
    return this._formatTeacherProfile(teacher);
  }

  _formatTeacherProfile(teacher) {
    const formattedCourses = teacher.courses.map(c => {
      const f = this._format(c);
      return {
        id: f.id, title: f.title, price: f.price, thumbnail: f.thumbnail,
        level: f.level, category: f.category,
        studentsCount: f.stats?.enrollments ?? 0,
        lessonsCount:  f.stats?.lessons     ?? 0,
      };
    });
    return {
      id: teacher.id, userId: teacher.userId,
      name: teacher.user.name, avatar: teacher.user.avatar,
      email: teacher.user.email, phone: teacher.user.phone,
      bio: teacher.bio, expertise: teacher.expertise,
      specialties: teacher.specialties ?? [], verified: teacher.verified,
      ratingAvg: teacher.ratingAvg ? parseFloat(teacher.ratingAvg) : 0,
      memberSince: teacher.user.createdAt,
      coursesCount: teacher._count.courses, booksCount: teacher._count.books,
      courses: formattedCourses,
      books: teacher.books.map(b => ({
        id: b.id, title: b.title, price: b.price,
        subject: b.subject, grade: b.grade, coverImage: b.coverImage,
        purchases: b._count?.purchases ?? 0,
      })),
    };
  }

  _format(course) {
    let meta = {};
    try { meta = JSON.parse(course.description || '{}'); } catch { meta = { text: course.description }; }

    return {
      id:            course.id,
      title:         course.title,
      description:   meta.text          ?? course.description ?? '',
      category:      meta.category      ?? '',
      level:         meta.level         ?? '',
      duration:      meta.duration      ?? null,
      maxStudents:   meta.maxStudents   ?? null,
      startDate:     meta.startDate     ?? null,
      endDate:       meta.endDate       ?? null,
      prerequisites: meta.prerequisites ?? [],
      thumbnail:     course.thumbnail,
      price:         course.price,
      platformFee:   course.platformFee,
      teacherEarning: course.teacherEarning,
      isPublished:   course.isPublished,
      createdAt:     course.createdAt,
      updatedAt:     course.updatedAt,
      teacher: course.teacher ? {
        id: course.teacher.id, userId: course.teacher.userId,
        name: course.teacher.user?.name, avatar: course.teacher.user?.avatar,
      } : undefined,
      stats: course._count ? {
        enrollments: course._count.enrollments,
        lessons:     course._count.lessons,
      } : undefined,
      lessons: course.lessons ?? undefined,
    };
  }
}

export default new CoursesService();