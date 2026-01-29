import express from 'express';
import authController from './auth.controller.js';
import { authMiddleware } from './auth.middleware.js';
import {
  registerValidation,
  loginValidation,
  updateProfileValidation,
  addPasswordValidation,
  changePasswordValidation,
} from './auth.validator.js';

const router = express.Router();

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * @route   POST /api/auth/register
 * @desc    Register with email/password
 * @access  Public
 */
router.post('/register', registerValidation, authController.registerLocal);

/**
 * @route   POST /api/auth/login
 * @desc    Login with email/password
 * @access  Public
 */
router.post('/login', loginValidation, authController.loginLocal);

/**
 * @route   POST /api/auth/clerk
 * @desc    Login/Register with Clerk (Google/Social)
 * @access  Public
 */
router.post('/clerk', authController.loginClerk);

/**
 * @route   GET /api/auth/test
 * @desc    Test endpoint
 * @access  Public
 */
router.get('/test', authController.test);

// ============================================
// PROTECTED ROUTES
// ============================================

/**
 * @route   GET /api/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get('/me', authMiddleware, authController.getCurrentUser);

/**
 * @route   PUT /api/auth/profile
 * @desc    Update profile
 * @access  Private
 */
router.put('/profile', authMiddleware, updateProfileValidation, authController.updateProfile);

/**
 * @route   POST /api/auth/add-password
 * @desc    Add password to Clerk user
 * @access  Private
 */
router.post('/add-password', authMiddleware, addPasswordValidation, authController.addPassword);

/**
 * @route   PUT /api/auth/change-password
 * @desc    Change password
 * @access  Private
 */
router.put('/change-password', authMiddleware, changePasswordValidation, authController.changePassword);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout
 * @access  Private
 */
router.post('/logout', authMiddleware, authController.logout);

export default router;
