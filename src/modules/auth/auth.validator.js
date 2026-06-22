// backend/src/modules/auth/auth.validator.js - FIXED
import { body, validationResult } from 'express-validator';
import prisma from '../../config/prisma.config.js';

/**
 * Validation middleware
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }
  next();
};

/**
 * Register validation - ✅ FIXED: Added assistant_teacher role
 */
export const registerValidation = [
  body('email')
    .isEmail()
    .withMessage('Invalid email address')
    .normalizeEmail(),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name must be at least 2 characters'),
  
  // ✅ FIXED: Added assistant_teacher to allowed roles
  body('role')
    .optional()
    .isIn(['student', 'teacher', 'assistant_teacher', 'parent'])
    .withMessage('Invalid role'),
  
  body('phone')
    .optional()
    .matches(/^01[0-2,5]{1}[0-9]{8}$/)
    .withMessage('Invalid Egyptian phone number')
    .custom(async (value) => {
      if (!value) return true;
      const user = await prisma.user.findFirst({ where: { phone: value } });
      if (user) throw new Error('رقم الهاتف مستخدم بالفعل، يرجى إدخال رقم آخر');
      return true;
    }),
  
  // ✅ Added division validation for students
  // OLD canonical stream values (migrated to planning-file canonical names per decision 3):
  // body('division')
  //   .optional()
  //   .isIn(['science-math', 'science-bio', 'arts'])
  //   .withMessage('Invalid division'),
  // ✅ NEW canonical stream values (Literary / Science-Maths / Science-Biology) — see planning_prompts + session_context §4
  body('division')
    .optional()
    .isIn(['Literary', 'Science-Maths', 'Science-Biology'])
    .withMessage('Invalid division'),

  // ✅ NEW: teacher stream validation (Teacher.stream)
  // OLD: 3 values (matched student division / contest stream)
  // body('stream')
  //   .optional()
  //   .isIn(['Literary', 'Science-Maths', 'Science-Biology'])
  //   .withMessage('Invalid stream'),
  // ✅ NEW: 5 values — 3 shared (Literary/Science-Maths/Science-Biology, match Student.stream & Contest.stream
  //   for the notification join) + 2 teacher-only (general, science). A DB CHECK constraint enforces the same set.
  //   NOTE: extends planning_prompts' 3-value stream definition per user decision; mapping is teachers-only.
  body('stream')
    .optional()
    .isIn(['Literary', 'Science-Maths', 'Science-Biology', 'general', 'science'])
    .withMessage('Invalid stream'),

  // ✅ NEW: student academic year (StudentYear enum) — DB enum enforces too; backend enforcement here
  body('year')
    .optional()
    .isIn(['first', 'second', 'third'])
    .withMessage('Invalid year, must be one of: first, second, third'),

  validate,
];

/**
 * Login validation
 */
export const loginValidation = [
  body('email')
    .isEmail()
    .withMessage('Invalid email address')
    .normalizeEmail(),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  
  validate,
];

/**
 * Update profile validation
 */
export const updateProfileValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name must be at least 2 characters'),
  
  body('phone')
    .optional()
    .matches(/^01[0-2,5]{1}[0-9]{8}$/)
    .withMessage('Invalid Egyptian phone number'),
  
  validate,
];

/**
 * Add password validation
 */
export const addPasswordValidation = [
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  
  validate,
];

/**
 * Phone update validation
 */
export const phoneValidation = [
  body('phone')
    .notEmpty().withMessage('رقم الهاتف مطلوب')
    .matches(/^01[0-2,5]{1}[0-9]{8}$/)
    .withMessage('رقم الهاتف غير صالح'),
  validate,
];

/**
 * Change password validation
 */
export const changePasswordValidation = [
  body('oldPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  
  validate,
];