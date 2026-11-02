import teachersService from './teachers.service.js';

class TeachersController {

  async getProfile(req, res, next) {
    try {
      const profile = await teachersService.getProfile(req.user.userId);
      res.status(200).json({ success: true, data: profile });
    } catch (error) {
      next(error);
    }
  }

  async checkHasAssistant(req, res, next) {
    try {
      const result = await teachersService.hasAssistant(req.user.userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/teachers/assistants
   * Get all assistant teachers linked to the current teacher
   */
  async getAssistants(req, res, next) {
    try {
      const assistants = await teachersService.getAssistants(req.user.userId);
      res.status(200).json({ success: true, data: assistants });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/teachers/assistants/:id/create-checkout-session
   * Create a Stripe Checkout Session → teacher gets redirected to Stripe payment page
   */
  async createActivationCheckoutSession(req, res, next) {
    try {
      // Use FRONTEND_URL env var, or fall back to the request's Origin header, or localhost:5173
    const frontendUrl = process.env.FRONTEND_URL
      || req.headers.origin
      || 'http://localhost:5173';
      const result = await teachersService.createActivationCheckoutSession(
        req.user.userId,
        req.params.id,
        frontendUrl,
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/teachers/assistants/:id/confirm-activation
   * Confirm activation after successful payment (called from success page)
   */
  async confirmActivation(req, res, next) {
    try {
      const result = await teachersService.confirmActivation(req.params.id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/teachers/stripe-key
   * Get Stripe publishable key for frontend
   */
  async getStripeKey(req, res, next) {
    try {
      const key = teachersService.getStripePublishableKey();
      res.status(200).json({ success: true, data: { publishableKey: key } });
    } catch (error) {
      next(error);
    }
  }
}

export default new TeachersController();
