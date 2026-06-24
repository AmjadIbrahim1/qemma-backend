// backend/src/modules/payments/payment.routes.js

import express from 'express';
import paymentController from './payment.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

// جلب بيانات المنتج (عام — يُستخدم لعرض صفحة الدفع)
router.get('/item/:itemType/:itemId', paymentController.getItemDetails);

// التحقق من كود الخصم (عام)
router.post('/validate-promo', paymentController.validatePromoCode);

// تنفيذ عملية الشراء (يتطلب تسجيل الدخول)
router.post('/process', authMiddleware, paymentController.processPayment);

export default router;