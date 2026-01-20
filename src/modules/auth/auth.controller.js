// backend/src/modules/auth/auth.controller.js
import authService from './auth.service.js';

class AuthController {
  /**
   * POST /api/auth/register
   */
  async registerLocal(req, res, next) {
    try {
      const result = await authService.registerLocal(req.body);
      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/login
   */
  async loginLocal(req, res, next) {
    try {
      const { email, password } = req.body;
      const result = await authService.loginLocal(email, password);
      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/clerk
   * Body: { clerkUserId: "user_xxx...", role: "student" }
   */
  async loginClerk(req, res, next) {
    try {
      console.log('📨 Clerk login request:', req.body);
      
      const { clerkUserId, role } = req.body;

      if (!clerkUserId) {
        return res.status(400).json({
          success: false,
          message: 'clerkUserId is required',
        });
      }

      // Default to 'student' if no role provided
      const userRole = role || 'student';

      const result = await authService.loginClerk(clerkUserId, userRole);
      
      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: result,
      });
    } catch (error) {
      console.error('❌ Clerk login controller error:', error);
      next(error);
    }
  }

  /**
   * GET /api/auth/me
   */
  async getCurrentUser(req, res, next) {
    try {
      const user = await authService.getCurrentUser(req.user.userId);
      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/auth/profile
   */
  async updateProfile(req, res, next) {
    try {
      const user = await authService.updateProfile(req.user.userId, req.body);
      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/add-password
   */
  async addPassword(req, res, next) {
    try {
      const { password } = req.body;
      const result = await authService.addPassword(req.user.userId, password);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/auth/change-password
   */
  async changePassword(req, res, next) {
    try {
      const { oldPassword, newPassword } = req.body;
      const result = await authService.changePassword(
        req.user.userId, 
        oldPassword, 
        newPassword
      );
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/logout
   */
  async logout(req, res) {
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  }

  /**
   * GET /api/auth/test
   */
  async test(req, res) {
    res.status(200).json({
      success: true,
      message: 'Auth routes working! 🚀',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 🔧 DEBUG: GET /api/auth/debug/credentials
   * DEVELOPMENT ONLY - Shows user info for debugging
   */
  async debugCredentials(req, res, next) {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({
        success: false,
        message: 'This endpoint is only available in development mode',
      });
    }

    try {
      const user = await authService.getUserCredentials(req.user.userId);
      res.status(200).json({
        success: true,
        message: '🔧 Debug Info (Development Only)',
        data: {
          ...user,
          note: 'Password is hashed and stored securely. You can login with your email.',
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new AuthController();