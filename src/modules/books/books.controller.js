// backend/src/modules/books/books.controller.js
// CHANGE: No multer file extraction — coverBase64 comes in req.body

import booksService from './books.service.js';

const ok   = (res, data, msg = 'Success', status = 200) =>
  res.status(status).json({ success: true, message: msg, data });

const fail = (res, msg, status = 500) =>
  res.status(status).json({ success: false, message: msg });

class BooksController {

  async createBook(req, res) {
    try {
      const book = await booksService.createBook(req.user.userId, req.body, req.file);
      return ok(res, book, 'تم إضافة الكتاب بنجاح', 201);
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }

  async getTeacherBooks(req, res) {
    try {
      const books = await booksService.getTeacherBooks(req.user.userId);
      return ok(res, books);
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }

  async getPublishedBooks(req, res) {
    try {
      const result = await booksService.getPublishedBooks(req.query);
      return ok(res, result);
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }

  async getBook(req, res) {
    try {
      const book = await booksService.getBook(req.params.id, req.user?.userId);
      return ok(res, book);
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }

  async checkPurchaseStatus(req, res) {
    try {
      const result = await booksService.checkStudentPurchase(req.params.id, req.user.userId);
      return ok(res, result);
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }

  async updateBook(req, res) {
    try {
      const book = await booksService.updateBook(req.params.id, req.user.userId, req.body, req.file);
      return ok(res, book, 'تم تحديث الكتاب بنجاح');
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }

  async deleteBook(req, res) {
    try {
      const result = await booksService.deleteBook(req.params.id, req.user.userId);
      return ok(res, result);
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }

  async togglePublish(req, res) {
    try {
      const result = await booksService.togglePublish(req.params.id, req.user.userId);
      return ok(res, result);
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }

  async purchaseBook(req, res) {
    try {
      const result = await booksService.purchaseBook(req.params.id, req.user.userId);
      return ok(res, result, 'تم شراء الكتاب بنجاح', 201);
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }

  async getStudentBooks(req, res) {
    try {
      const books = await booksService.getStudentBooks(req.user.userId);
      return ok(res, books);
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }

  async getTeacherBookStats(req, res) {
    try {
      const stats = await booksService.getTeacherBookStats(req.user.userId);
      return ok(res, stats);
    } catch (e) { return fail(res, e.message, e.statusCode || 500); }
  }
}

export default new BooksController();