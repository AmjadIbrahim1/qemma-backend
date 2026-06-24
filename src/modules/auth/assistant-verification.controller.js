// backend/src/modules/auth/assistant-verification.controller.js

import assistantVerificationService from './assistant-verification.service.js';

class AssistantVerificationController {
  // ─── TEACHER / ASSISTANT FLOW ────────────────────────────────

  /**
   * POST /api/auth/assistant/send-code
   * Body: { teacherUsername, assistantEmail }
   */
  async sendCode(req, res, next) {
    try {
      const { teacherUsername, assistantEmail } = req.body;

      if (!teacherUsername || !assistantEmail) {
        return res.status(400).json({
          success: false,
          message: 'teacherUsername and assistantEmail are required',
        });
      }

      const result = await assistantVerificationService.sendVerificationCode(
        teacherUsername.trim(),
        assistantEmail.trim(),
      );

      res.status(200).json({
        success: true,
        message: 'تم إرسال كود التحقق للمدرس',
        data: {
          teacherName:     result.targetName,
          teacherUsername: result.targetUsername,
          // ⚠️ Remove `code` in production — only for dev/demo
          ...(process.env.NODE_ENV === 'development' ? { code: result.code } : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/assistant/verify-code
   * Body: { teacherUsername, code }
   */
  async verifyCode(req, res, next) {
    try {
      const { teacherUsername, code } = req.body;

      if (!teacherUsername || !code) {
        return res.status(400).json({
          success: false,
          message: 'teacherUsername and code are required',
        });
      }

      const result = assistantVerificationService.verifyCode(
        teacherUsername.trim(),
        code.trim(),
      );

      res.status(200).json({
        success: true,
        message: 'تم التحقق بنجاح',
        data:    result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/auth/assistant/teacher/:username
   */
  async getTeacher(req, res, next) {
    try {
      const { username } = req.params;
      const teacher = await assistantVerificationService.getTeacherByUsername(username);
      res.status(200).json({ success: true, data: teacher });
    } catch (error) {
      next(error);
    }
  }

  // ─── PARENT / STUDENT FLOW ───────────────────────────────────

  /**
   * POST /api/auth/parent/send-code
   * Body: { studentUsername, parentEmail }
   */
  async sendParentCode(req, res, next) {
    try {
      const { studentUsername, parentEmail } = req.body;

      if (!studentUsername || !parentEmail) {
        return res.status(400).json({
          success: false,
          message: 'studentUsername and parentEmail are required',
        });
      }

      const result = await assistantVerificationService.sendParentVerificationCode(
        studentUsername.trim(),
        parentEmail.trim(),
      );

      res.status(200).json({
        success: true,
        message: 'تم إرسال كود التحقق للطالب',
        data: {
          studentName:     result.targetName,
          studentUsername: result.targetUsername,
          // ⚠️ Remove `code` in production — only for dev/demo
          ...(process.env.NODE_ENV === 'development' ? { code: result.code } : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/parent/verify-code
   * Body: { studentUsername, code }
   */
  async verifyParentCode(req, res, next) {
    try {
      const { studentUsername, code } = req.body;

      if (!studentUsername || !code) {
        return res.status(400).json({
          success: false,
          message: 'studentUsername and code are required',
        });
      }

      const result = assistantVerificationService.verifyParentCode(
        studentUsername.trim(),
        code.trim(),
      );

      res.status(200).json({
        success: true,
        message: 'تم التحقق بنجاح',
        data:    result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/auth/parent/student/:username
   */
  async getStudent(req, res, next) {
    try {
      const { username } = req.params;
      const student = await assistantVerificationService.getStudentByUsername(username);
      res.status(200).json({ success: true, data: student });
    } catch (error) {
      next(error);
    }
  }
}

export default new AssistantVerificationController();