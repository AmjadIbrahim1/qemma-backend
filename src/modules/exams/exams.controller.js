import examsService from './exams.service.js';

const ok = (res, data, message = 'Success', status = 200) =>
  res.status(status).json({ success: true, message, data });

const fail = (res, err) =>
  res.status(err.statusCode || 500).json({ success: false, message: err.message });

class ExamsController {

  async createExam(req, res, next) {
    try {
      const exam = await examsService.createExam(req.user.userId, req.body);
      return ok(res, exam, 'تم إنشاء الاختبار بنجاح', 201);
    } catch (err) { next(err); }
  }

  async getMyExams(req, res, next) {
    try {
      const exams = await examsService.getTeacherExams(req.user.userId);
      return ok(res, exams);
    } catch (err) { next(err); }
  }

  // GET /api/exams/student  ← للطالب: كل امتحانات الكورسات المشترك فيها
  async getStudentExams(req, res, next) {
    try {
      const exams = await examsService.getStudentExams(req.user.userId);
      return ok(res, exams);
    } catch (err) { next(err); }
  }

  async getExamAttempts(req, res, next) {
    try {
      const attempts = await examsService.getExamAttempts(req.params.id, req.user.userId);
      return ok(res, attempts);
    } catch (err) { next(err); }
  }

  async getExam(req, res, next) {
    try {
      const exam = await examsService.getExam(req.params.id, req.user?.userId);
      return ok(res, exam);
    } catch (err) { next(err); }
  }

  async updateExam(req, res, next) {
    try {
      const exam = await examsService.updateExam(req.params.id, req.user.userId, req.body);
      return ok(res, exam, 'تم تحديث الاختبار بنجاح');
    } catch (err) { next(err); }
  }

  async deleteExam(req, res, next) {
    try {
      const result = await examsService.deleteExam(req.params.id, req.user.userId);
      return ok(res, result);
    } catch (err) { next(err); }
  }

  async togglePublish(req, res, next) {
    try {
      const result = await examsService.togglePublish(req.params.id, req.user.userId);
      return ok(res, result);
    } catch (err) { next(err); }
  }
}

export default new ExamsController();