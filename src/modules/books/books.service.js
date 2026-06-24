// backend/src/modules/books/books.service.js

import prisma from '../../config/prisma.config.js';
import path   from 'path';
import fs     from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const VALID_GRADES = ['الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];

class BooksService {

  async _getTeacher(userId) {
    const teacher = await prisma.teacher.findUnique({
      where:   { userId },
      include: { user: { select: { name: true, avatar: true } } },
    });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 403 });
    return teacher;
  }

  // ── helper: save file to disk ─────────────────────────────────
  _saveFile(file, subfolder) {
    try {
      const uploadDir = path.join(__dirname, '../../../public/uploads/books', subfolder);
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      const ext      = path.extname(file.originalname) || '.pdf';
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const filePath = path.join(uploadDir, fileName);

      fs.writeFileSync(filePath, file.buffer);
      return `/uploads/books/${subfolder}/${fileName}`;
    } catch (err) {
      console.error('⚠️ Book file save error:', err.message);
      return null;
    }
  }

  // ── CREATE book ─────────────────────────────────────────────────
  async createBook(userId, data, pdfFile) {
    const teacher = await this._getTeacher(userId);
    const { title, description, price, isPublished, coverBase64, bookType } = data;

    // subject comes from teacher's own profile (set at registration)
    const subject = teacher.expertise || teacher.specialties?.[0] || null;

    // grade is chosen by teacher from the 3 fixed options
    const grade = data.grade?.trim();

    if (!title?.trim())              throw Object.assign(new Error('عنوان الكتاب مطلوب'),          { statusCode: 400 });
    if (!grade)                      throw Object.assign(new Error('الصف الدراسي مطلوب'),          { statusCode: 400 });
    if (!VALID_GRADES.includes(grade)) throw Object.assign(new Error('الصف الدراسي غير صحيح'),    { statusCode: 400 });

    let pdfFileRef = null;
    if (pdfFile) {
      pdfFileRef = this._saveFile(pdfFile, 'pdfs');
    }

    const book = await prisma.book.create({
      data: {
        teacherId:   teacher.id,
        title:       title.trim(),
        description: description || null,
        subject:     subject || 'عام',
        grade,
        price:       parseFloat(price) || 0,
        coverImage:  coverBase64 || null,
        pdfFileRef,
        bookType:    bookType || 'physical',
        isPublished: isPublished === 'true' || isPublished === true,
      },
      include: {
        teacher: { include: { user: { select: { name: true, avatar: true } } } },
        _count:  { select: { purchases: true } },
      },
    });

    return this._format(book);
  }

  // ── LIST teacher's books ────────────────────────────────────────
  async getTeacherBooks(userId) {
    const teacher = await this._getTeacher(userId);

    const books = await prisma.book.findMany({
      where:   { teacherId: teacher.id },
      include: {
        teacher: { include: { user: { select: { name: true, avatar: true } } } },
        _count:  { select: { purchases: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return books.map(b => this._format(b));
  }

  // ── LIST published books (public) ───────────────────────────────
  async getPublishedBooks({ subject, grade, search, page = 1, limit = 20 } = {}) {
    const where = {
      isPublished: true,
      ...(subject && { subject }),
      ...(grade   && { grade }),
      ...(search  && {
        OR: [
          { title:       { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [books, total] = await Promise.all([
      prisma.book.findMany({
        where,
        skip,
        take:    parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          teacher: { include: { user: { select: { name: true, avatar: true } } } },
          _count:  { select: { purchases: true } },
        },
      }),
      prisma.book.count({ where }),
    ]);

    return {
      books: books.map(b => this._format(b)),
      pagination: {
        page:       parseInt(page),
        limit:      parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  // ── GET single book ─────────────────────────────────────────────
  async getBook(bookId, userId) {
    const book = await prisma.book.findUnique({
      where:   { id: bookId },
      include: {
        teacher: { include: { user: { select: { name: true, avatar: true } } } },
        _count:  { select: { purchases: true } },
      },
    });
    if (!book) throw Object.assign(new Error('الكتاب غير موجود'), { statusCode: 404 });

    const result = this._format(book);

    if (userId) {
      const student = await prisma.student.findUnique({ where: { userId } });
      if (student) {
        const purchase = await prisma.bookPurchase.findUnique({
          where: { bookId_studentId: { bookId, studentId: student.id } },
        });
        result.hasPurchased = !!purchase;
      }
    }

    return result;
  }

  // ── UPDATE book ─────────────────────────────────────────────────
  async updateBook(bookId, userId, data, pdfFile) {
    const teacher = await this._getTeacher(userId);

    const book = await prisma.book.findUnique({ where: { id: bookId } });
    if (!book || book.teacherId !== teacher.id) {
      throw Object.assign(new Error('الكتاب غير موجود أو غير مصرح'), { statusCode: 404 });
    }

    const { title, description, grade, price, isPublished, coverBase64, bookType } = data;

    if (grade && !VALID_GRADES.includes(grade.trim())) {
      throw Object.assign(new Error('الصف الدراسي غير صحيح'), { statusCode: 400 });
    }

    let pdfFileRef = data.pdfFileRef !== undefined ? (data.pdfFileRef || null) : undefined;
    if (pdfFile) {
      pdfFileRef = this._saveFile(pdfFile, 'pdfs');
    }

    const updated = await prisma.book.update({
      where: { id: bookId },
      data: {
        ...(title       !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description }),
        ...(grade       !== undefined && { grade: grade.trim() }),
        ...(price       !== undefined && { price: parseFloat(price) || 0 }),
        ...(isPublished !== undefined && { isPublished: isPublished === 'true' || isPublished === true }),
        ...(coverBase64 !== undefined && { coverImage: coverBase64 || null }),
        ...(pdfFileRef  !== undefined && { pdfFileRef }),
        ...(bookType    !== undefined && { bookType }),
      },
      include: {
        teacher: { include: { user: { select: { name: true, avatar: true } } } },
        _count:  { select: { purchases: true } },
      },
    });

    return this._format(updated);
  }

  // ── DELETE book ─────────────────────────────────────────────────
  async deleteBook(bookId, userId) {
    const teacher = await this._getTeacher(userId);

    const book = await prisma.book.findUnique({ where: { id: bookId } });
    if (!book || book.teacherId !== teacher.id) {
      throw Object.assign(new Error('الكتاب غير موجود أو غير مصرح'), { statusCode: 404 });
    }

    await prisma.book.delete({ where: { id: bookId } });
    return { message: 'تم حذف الكتاب بنجاح' };
  }

  // ── Toggle publish ──────────────────────────────────────────────
  async togglePublish(bookId, userId) {
    const teacher = await this._getTeacher(userId);
    const book = await prisma.book.findUnique({ where: { id: bookId } });
    if (!book || book.teacherId !== teacher.id) {
      throw Object.assign(new Error('الكتاب غير موجود أو غير مصرح'), { statusCode: 404 });
    }
    const updated = await prisma.book.update({
      where: { id: bookId },
      data:  { isPublished: !book.isPublished },
    });
    return { isPublished: updated.isPublished };
  }

  // ── Check if student purchased book ──────────────────────────
  async checkStudentPurchase(bookId, userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) return { hasPurchased: false };

    const purchase = await prisma.bookPurchase.findUnique({
      where: { bookId_studentId: { bookId, studentId: student.id } },
    });

    return { hasPurchased: !!purchase };
  }

  // ── Purchase book ───────────────────────────────────────────────
  async purchaseBook(bookId, userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('Student not found'), { statusCode: 403 });

    const book = await prisma.book.findUnique({ where: { id: bookId } });
    if (!book || !book.isPublished) throw Object.assign(new Error('الكتاب غير متاح'), { statusCode: 404 });

    const existing = await prisma.bookPurchase.findUnique({
      where: { bookId_studentId: { bookId, studentId: student.id } },
    });
    if (existing) throw Object.assign(new Error('تم شراء هذا الكتاب مسبقاً'), { statusCode: 400 });

    const price      = book.price || 0;
    const platformCommission = parseFloat((price * 0.10).toFixed(2));
    const teacherEarning     = parseFloat((price * 0.90).toFixed(2));

    return prisma.bookPurchase.create({
      data: { bookId, studentId: student.id, platformCommission, teacherEarning },
    });
  }

  // ── Get student's purchased books ───────────────────────────────
  async getStudentBooks(userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) return [];

    const purchases = await prisma.bookPurchase.findMany({
      where:   { studentId: student.id },
      include: {
        book: {
          include: {
            teacher: { include: { user: { select: { name: true, avatar: true } } } },
            _count:  { select: { purchases: true } },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
    });

    return purchases.map(p => ({ ...this._format(p.book), purchasedAt: p.paidAt }));
  }

  // ── Stats for teacher ───────────────────────────────────────────
  async getTeacherBookStats(userId) {
    const teacher = await this._getTeacher(userId);

    const [totalBooks, publishedBooks, totalPurchases] = await Promise.all([
      prisma.book.count({ where: { teacherId: teacher.id } }),
      prisma.book.count({ where: { teacherId: teacher.id, isPublished: true } }),
      prisma.bookPurchase.count({ where: { book: { teacherId: teacher.id } } }),
    ]);

    return { totalBooks, publishedBooks, totalPurchases };
  }

  _format(book) {
    return {
      id:            book.id,
      teacherId:     book.teacherId,
      teacherName:   book.teacher?.user?.name   ?? null,
      teacherAvatar: book.teacher?.user?.avatar ?? null,
      title:         book.title,
      description:   book.description ?? null,
      subject:       book.subject,
      grade:         book.grade,
      price:         book.price,
      coverImage:    book.coverImage ?? null,
      pdfFileRef:    book.pdfFileRef ?? null,
      bookType:      book.bookType ?? 'physical',
      isPublished:   book.isPublished,
      purchases:     book._count?.purchases ?? 0,
      createdAt:     book.createdAt,
      updatedAt:     book.updatedAt,
    };
  }
}

export default new BooksService();