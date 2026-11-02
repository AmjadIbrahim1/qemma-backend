// backend/src/modules/assistant/assistant.controller.js

import assistantService from './assistant.service.js';

class AssistantController {

  /**
   * GET /api/assistant/info
   * Returns the assistant's own info and linked teacher info
   */
  async getInfo(req, res, next) {
    try {
      const data = await assistantService.getAssistantInfo(req.user.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/assistant/students
   * Returns all students enrolled in the linked main teacher's courses
   */
  async getStudents(req, res, next) {
    try {
      const data = await assistantService.getLinkedTeacherStudents(req.user.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/assistant/students/:studentId
   * Returns detailed info about a single student
   */
  async getStudentDetail(req, res, next) {
    try {
      const data = await assistantService.getStudentDetail(
        req.user.userId,
        req.params.studentId,
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}

export default new AssistantController();