// backend/src/modules/assistant/assistant.routes.js

import express from 'express';
import assistantController from './assistant.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireActivatedAssistant } from '../auth/assistant-activation.middleware.js';

const router = express.Router();

// All assistant routes require authentication
router.use(authMiddleware);

// ✅ Apply activation check to ALL assistant routes — inactive assistants are blocked
router.use(requireActivatedAssistant);

// GET /api/assistant/info — assistant's own info + linked teacher
router.get('/info', assistantController.getInfo.bind(assistantController));

// GET /api/assistant/students — all students of the linked teacher
router.get('/students', assistantController.getStudents.bind(assistantController));

// GET /api/assistant/students/:studentId — single student detail
router.get('/students/:studentId', assistantController.getStudentDetail.bind(assistantController));

export default router;