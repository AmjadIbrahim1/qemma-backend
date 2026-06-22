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
}

export default new TeachersController();
