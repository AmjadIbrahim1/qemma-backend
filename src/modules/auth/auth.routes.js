// backend/src/modules/auth/auth.routes.js

import express from 'express';
import authController from './auth.controller.js';
import assistantVerificationController from './assistant-verification.controller.js';
import { authMiddleware } from './auth.middleware.js';
import {
  registerValidation,
  loginValidation,
  updateProfileValidation,
  addPasswordValidation,
  changePasswordValidation,
  phoneValidation,
} from './auth.validator.js';

const router = express.Router();

// ============================================================
// PUBLIC ROUTES
// ============================================================

router.post('/register', registerValidation, authController.registerLocal);
router.post('/login',    loginValidation,    authController.loginLocal);
router.post('/clerk',                        authController.loginClerk);
router.get('/test',                          authController.test);

router.post('/check-phone', phoneValidation, authController.checkPhone);

// ── Assistant teacher verification ──────────────────────────
router.post('/assistant/send-code',        assistantVerificationController.sendCode);
router.post('/assistant/verify-code',      assistantVerificationController.verifyCode);
router.get( '/assistant/teacher/:username', assistantVerificationController.getTeacher);

// ── Password reset ──────────────────────────────────────────
router.post('/forgot-password',            authController.forgotPassword);

// ── Parent / student verification ───────────────────────────
router.post('/parent/send-code',           assistantVerificationController.sendParentCode);
router.post('/parent/verify-code',         assistantVerificationController.verifyParentCode);
router.get( '/parent/student/:username',   assistantVerificationController.getStudent);

// ============================================================
// PROTECTED ROUTES
// ============================================================

router.get( '/me',              authMiddleware,                                authController.getCurrentUser);
router.patch('/phone',          authMiddleware, phoneValidation,               authController.updatePhone);
router.put( '/profile',         authMiddleware, updateProfileValidation,       authController.updateProfile);
router.post('/add-password',    authMiddleware, addPasswordValidation,         authController.addPassword);
router.put( '/change-password', authMiddleware, changePasswordValidation,      authController.changePassword);
router.post('/logout',          authMiddleware,                                authController.logout);

// 🔧 DEBUG (development only)
router.get('/debug/credentials', authMiddleware, authController.debugCredentials);

export default router;