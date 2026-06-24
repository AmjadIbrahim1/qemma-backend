// backend/src/modules/students/students.routes.js

import express from 'express';
import studentsController from './students.controller.js';
import { authMiddleware, authorizeRoles } from '../auth/auth.middleware.js';

const router = express.Router();
router.use(authMiddleware);

router.get('/dashboard',   studentsController.getDashboard);
router.get('/performance', studentsController.getPerformance);
router.get('/tasks',       studentsController.getTasks);

router.post('/rate/lesson/:lessonId',   authorizeRoles('student'), studentsController.rateLesson);
router.post('/rate/teacher/:teacherId', authorizeRoles('student'), studentsController.rateTeacher);
router.post('/rate/course/:courseId',   authorizeRoles('student'), studentsController.rateCourse);
router.post('/rate/book/:bookId',       authorizeRoles('student'), studentsController.rateBook);
router.get('/rate/lesson/:lessonId',    studentsController.getLessonRating);
router.get('/rate/teacher/:teacherId',  studentsController.getTeacherRating);
router.get('/rate/course/:courseId',    studentsController.getCourseRating);
router.get('/rate/book/:bookId',        studentsController.getBookRating);

export default router;
