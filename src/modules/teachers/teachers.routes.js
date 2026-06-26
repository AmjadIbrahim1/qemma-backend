import express from 'express';
import teachersController from './teachers.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

router.get('/me/has-assistant', authMiddleware, (req, res, next) => teachersController.checkHasAssistant(req, res, next));
router.get('/me',              authMiddleware, (req, res, next) => teachersController.getProfile(req, res, next));

// ✅ NEW: Assistant teacher management routes
router.get('/assistants',                      authMiddleware, (req, res, next) => teachersController.getAssistants(req, res, next));
router.post('/assistants/:id/create-checkout-session', authMiddleware, (req, res, next) => teachersController.createActivationCheckoutSession(req, res, next));
router.post('/assistants/:id/confirm-activation',    authMiddleware, (req, res, next) => teachersController.confirmActivation(req, res, next));

// Stripe public key
router.get('/stripe-key', (req, res, next) => teachersController.getStripeKey(req, res, next));

export default router;
