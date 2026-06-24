// backend/src/modules/courses/courses.routes.js
// لا يوجد multer — الـ thumbnail يأتي كـ base64 في JSON body

import express from 'express';
import coursesController from './courses.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

// ══════════════════════════════════════════════════════════════
//  PUBLIC ROUTES — لا تحتاج JWT
// ══════════════════════════════════════════════════════════════

// الكورسات المنشورة للعرض العام
router.get('/public', (req, res) => coursesController.getPublishedCourses(req, res));

// ملف مدرس بـ Teacher.id
router.get('/teacher/:teacherId', (req, res) => coursesController.getTeacherProfile(req, res));

// ملف مدرس بـ User.id
router.get('/teacher-by-user/:userId', (req, res) => coursesController.getTeacherProfileByUserId(req, res));

// كورس عام بدون auth (للمعاينة قبل الشراء) — يجب أن يكون قبل /:id
router.get('/public/:id', (req, res) => coursesController.getPublicCourse(req, res));

// ══════════════════════════════════════════════════════════════
//  PROTECTED ROUTES — تحتاج JWT
// ══════════════════════════════════════════════════════════════

// كورسات المدرس
router.get('/my', authMiddleware, (req, res) => coursesController.getMyCourses(req, res));

// كورس بـ ID (مع auth)
router.get('/:id', authMiddleware, (req, res) => coursesController.getCourse(req, res));

// إنشاء كورس — JSON body (thumbnailBase64 بداخله)
router.post('/', authMiddleware, (req, res) => coursesController.createCourse(req, res));

// تعديل كورس — JSON body
router.put('/:id', authMiddleware, (req, res) => coursesController.updateCourse(req, res));

// حذف كورس
router.delete('/:id', authMiddleware, (req, res) => coursesController.deleteCourse(req, res));

// تبديل نشر/إخفاء
router.patch('/:id/publish', authMiddleware, (req, res) => coursesController.togglePublish(req, res));

export default router;