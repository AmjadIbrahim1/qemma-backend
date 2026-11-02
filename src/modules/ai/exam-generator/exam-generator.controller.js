import examGeneratorService from './exam-generator.service.js';

const ok = (res, data, message = 'Success', status = 200) =>
  res.status(status).json({ success: true, message, data });

const fail = (res, err) =>
  res.status(err.statusCode || 500).json({ success: false, message: err.message });

class ExamGeneratorController {

  async generate(req, res, next) {
    try {
      const { grade, subject, chapter, difficulty } = req.body;
      if (!grade || !subject || !chapter || !difficulty) {
        return res.status(400).json({
          success: false,
          message: 'جميع الحقول مطلوبة: الصف، المادة، الفصل، مستوى الصعوبة.',
        });
      }
      const exam = await examGeneratorService.generateExam(req.user.userId, { grade, subject, chapter, difficulty });
      return ok(res, exam, 'تم إنشاء الاختبار بنجاح', 201);
    } catch (err) { next(err); }
  }

  async submit(req, res, next) {
    try {
      const { answers } = req.body;
      if (!answers || typeof answers !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'الإجابات مطلوبة.',
        });
      }
      const result = await examGeneratorService.submitExam(req.user.userId, req.params.examId, answers);
      return ok(res, result, 'تم تقديم الاختبار بنجاح');
    } catch (err) { next(err); }
  }

  async review(req, res, next) {
    try {
      const result = await examGeneratorService.getExamReview(req.user.userId, req.params.examId);
      return ok(res, result);
    } catch (err) { next(err); }
  }

  async myExams(req, res, next) {
    try {
      const exams = await examGeneratorService.getMyAiExams(req.user.userId);
      return ok(res, exams);
    } catch (err) { next(err); }
  }

  async checkLimit(req, res, next) {
    try {
      const limit = await examGeneratorService.checkLimit(req.user.userId);
      return ok(res, limit);
    } catch (err) { next(err); }
  }
}

export default new ExamGeneratorController();
