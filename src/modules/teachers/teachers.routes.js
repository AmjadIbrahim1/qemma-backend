import express from 'express';
import teachersController from './teachers.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

router.get('/me/has-assistant', authMiddleware, (req, res, next) => teachersController.checkHasAssistant(req, res, next));
router.get('/me',              authMiddleware, (req, res, next) => teachersController.getProfile(req, res, next));

export default router;
