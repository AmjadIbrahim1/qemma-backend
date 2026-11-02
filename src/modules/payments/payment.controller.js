// backend/src/modules/payments/payment.controller.js

import paymentService from './payment.service.js';

class PaymentController {
  /**
   * POST /api/payments/process
   * يتطلب تسجيل الدخول (authMiddleware)
   */
  async processPayment(req, res, next) {
    try {
      const userId = req.user.userId;
      const { itemId, itemType, paymentMethod, promoCode, totalAmount } = req.body;

      if (!itemId || !itemType || !paymentMethod || totalAmount === undefined) {
        return res.status(400).json({
          success: false,
          message: 'itemId, itemType, paymentMethod, totalAmount are required',
        });
      }

      const result = await paymentService.processPayment({
        userId,
        itemId,
        itemType,
        paymentMethod,
        promoCode: promoCode || null,
        totalAmount: parseFloat(totalAmount),
      });

      res.status(200).json({
        success: true,
        message: 'تمت عملية الشراء بنجاح',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/payments/validate-promo
   * عام (لا يتطلب تسجيل الدخول)
   */
  async validatePromoCode(req, res, next) {
    try {
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({ success: false, message: 'code is required' });
      }

      const result = await paymentService.validatePromoCode(code);

      res.status(200).json({
        success: true,
        message: 'كود الخصم صحيح',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/payments/item/:itemType/:itemId
   * جلب بيانات المنتج قبل الدفع
   */
  async getItemDetails(req, res, next) {
    try {
      const { itemType, itemId } = req.params;

      const item = await paymentService.getItemDetails(itemId, itemType);

      res.status(200).json({
        success: true,
        data: item,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new PaymentController();