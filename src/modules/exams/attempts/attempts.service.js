// backend/src/modules/exams/attempts/attempts.service.js

import prisma from '../../../config/prisma.config.js';
import notificationsService from '../../notifications/notifications.service.js';
import { getIO } from '../../../socket/socket.config.js';


class AttemptsService {

  // ── Get all attempts for teacher's exams ─────────────────────
  async getTeacherAttempts(teacherId, { examId, courseId, status, page = 1, limit = 20 } = {}) {
    const skip = (page - 1) * limit;

    const where = {
      exam: {
        teacherId,
        ...(courseId && { courseId }),
        ...(examId && { id: examId }),
      },
      // 'pending' = submitted but has ungraded essay questions (isPassed is null when essays remain)
      ...(status === 'pending' && { submittedAt: { not: null }, isPassed: null }),
      ...(status === 'graded'  && { score: { not: null } }),
    };

    const [attempts, total] = await Promise.all([
      prisma.examAttempt.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { submittedAt: 'desc' },
        include: {
          exam: {
            select: { id: true, title: true, totalMarks: true, passingMarks: true, courseId: true },
          },
          student: {
            include: {
              user: { select: { id: true, name: true, avatar: true } },
            },
          },
        },
      }),
      prisma.examAttempt.count({ where }),
    ]);

    return {
      attempts,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── Get single attempt with full details ──────────────────────
  async getAttemptById(attemptId) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            questions: { orderBy: { order: 'asc' } },
          },
        },
        student: {
          include: {
            user: { select: { id: true, name: true, avatar: true, email: true } },
          },
        },
      },
    });

    if (!attempt) {
      const err = new Error('Attempt not found');
      err.statusCode = 404;
      throw err;
    }

    return attempt;
  }

  // ── Grade a single attempt ────────────────────────────────────
  async gradeAttempt(attemptId, { score, feedback }) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: true },
    });

    if (!attempt) {
      const err = new Error('Attempt not found');
      err.statusCode = 404;
      throw err;
    }

    const isPassed = score >= attempt.exam.passingMarks;

    const updated = await prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        score,
        isPassed,
        finishedAt: new Date(),
      },
    });

    // Create/update grade record (no @@unique on studentId+examId, so use findFirst + upsert on id)
    const existingGrade = await prisma.grade.findFirst({
      where: { studentId: attempt.studentId, examId: attempt.examId },
    });
    if (existingGrade) {
      await prisma.grade.update({
        where: { id: existingGrade.id },
        data:  { score, gradedAt: new Date() },
      });
    } else {
      await prisma.grade.create({
        data: {
          studentId: attempt.studentId,
          examId:    attempt.examId,
          score,
          gradedAt:  new Date(),
        },
      });
    }

    return updated;
  }

  // ── Auto-grade MCQ/true-false attempt ─────────────────────────
  async autoGrade(attemptId) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: { questions: true },
        },
      },
    });

    if (!attempt) {
      const err = new Error('Attempt not found');
      err.statusCode = 404;
      throw err;
    }

    const answers = attempt.answers || {};
    let totalScore = 0;

    for (const question of attempt.exam.questions) {
      const studentAnswer = answers[question.id];
      if (studentAnswer && studentAnswer === question.correctAnswer) {
        totalScore += question.marks;
      }
    }

    return await this.gradeAttempt(attemptId, { score: totalScore });
  }

  // ── STUDENT: Start an exam (verify enrollment, return questions without answers) ─
  async startExam(examId, userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('Student profile not found'), { statusCode: 404 });

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        questions: { orderBy: { order: 'asc' } },
        course: { select: { id: true, title: true } },
      },
    });

    if (!exam) throw Object.assign(new Error('Exam not found'), { statusCode: 404 });
    if (!exam.isPublished) throw Object.assign(new Error('Exam is not published'), { statusCode: 403 });

    // Verify enrollment
    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId: student.id, courseId: exam.courseId } },
    });
    if (!enrollment) throw Object.assign(new Error('You are not enrolled in this course'), { statusCode: 403 });

    // Check availability window
    const now = new Date();
    if (exam.availableFrom && new Date(exam.availableFrom) > now)
      throw Object.assign(new Error('Exam is not yet available'), { statusCode: 403 });
    if (exam.availableTo && new Date(exam.availableTo) < now)
      throw Object.assign(new Error('Exam availability has expired'), { statusCode: 403 });

    // Check for existing incomplete attempt
    const existingAttempt = await prisma.examAttempt.findFirst({
      where: { examId, studentId: student.id, submittedAt: null },
    });

    let attempt;
    if (existingAttempt) {
      attempt = existingAttempt;
    } else {
      attempt = await prisma.examAttempt.create({
        data: {
          examId,
          studentId: student.id,
          answers: {},
          startedAt: now,
        },
      });
    }

    // Return questions WITHOUT correctAnswer for student
    return {
      attemptId: attempt.id,
      startedAt: attempt.startedAt,
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        durationMinutes: exam.durationMinutes || exam.duration,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        courseTitle: exam.course?.title,
      },
      questions: exam.questions.map(q => ({
        id: q.id,
        type: q.type,
        questionText: q.questionText,
        options: q.options ?? [],
        marks: q.marks,
        order: q.order,
      })),
    };
  }

  // ── STUDENT: Submit exam answers and auto-grade ─────────────────
  async submitExam(examId, userId, answers) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('Student profile not found'), { statusCode: 404 });

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!exam) throw Object.assign(new Error('Exam not found'), { statusCode: 404 });

    // Find the attempt
    const attempt = await prisma.examAttempt.findFirst({
      where: { examId, studentId: student.id, submittedAt: null },
    });
    if (!attempt) throw Object.assign(new Error('No active exam attempt found. Please start the exam first.'), { statusCode: 400 });

    // Classify questions
    const autoGradableTypes = ['multiple-choice', 'true-false', 'true/false', 'mcq'];
    const essayType = 'essay';

    let autoScore = 0;
    let autoTotal = 0;
    let essayCount = 0;
    let essayTotal = 0;
    const gradedDetails = [];

    for (const question of exam.questions) {
      const qType = (question.type || '').toLowerCase();
      const studentAnswer = answers[question.id] ?? null;
      const isAutoGradable = autoGradableTypes.includes(qType);

      if (isAutoGradable) {
        autoTotal += question.marks;
        const isCorrect = studentAnswer !== null && studentAnswer === question.correctAnswer;
        if (isCorrect) autoScore += question.marks;
        gradedDetails.push({
          questionId: question.id,
          type: question.type,
          correct: isCorrect,
          studentAnswer,
          correctAnswer: question.correctAnswer,
          marks: isCorrect ? question.marks : 0,
          maxMarks: question.marks,
        });
      } else if (qType === essayType) {
        essayCount++;
        essayTotal += question.marks;
        gradedDetails.push({
          questionId: question.id,
          type: question.type,
          correct: null, // pending
          studentAnswer,
          correctAnswer: null,
          marks: 0,
          maxMarks: question.marks,
          pending: true,
        });
      }
    }

    const hasEssayQuestions = essayCount > 0;
    const totalScore = autoScore;
    const totalPossible = autoTotal + essayTotal;
    const isPassed = !hasEssayQuestions ? totalScore >= exam.passingMarks : null;

    const now = new Date();

    const updatedAttempt = await prisma.examAttempt.update({
      where: { id: attempt.id },
      data: {
        answers,
        score: autoScore,
        isPassed,
        submittedAt: now,
        finishedAt: now,
      },
    });

    // ── If exam has essay questions, notify the assistant teacher ──
    if (hasEssayQuestions) {
      try {
        // Find the teacher who created the exam
        const examTeacher = await prisma.teacher.findUnique({
          where: { userId: exam.teacherId },
          select: { id: true },
        });
        if (examTeacher) {
          // Find assistant teacher linked to this teacher
          const assistantTeacher = await prisma.teacher.findFirst({
            where: { linkedTeacherId: examTeacher.id },
            include: { user: { select: { id: true, name: true } } },
          });
          if (assistantTeacher?.user) {
            // Also get the student user info
            const studentUser = await prisma.user.findUnique({
              where: { id: userId },
              select: { name: true },
            });
            // Notify the assistant teacher
            await notificationsService.create({
              userId: assistantTeacher.user.id,
              type: 'essay_grading',
              title: '📝 تقييم أسئلة مقالية',
              body: `تم تقديم اختبار "${exam.title}" من طالب ويحتوي على ${essayCount} أسئلة مقالية. يرجى تقييمها.`,
              data: {
                examId,
                examTitle: exam.title,
                attemptId: attempt.id,
                studentName: studentUser?.name || 'طالب',
                essayCount,
                courseId: exam.courseId,
              },
            });
            console.log(`📨 Essay grading notification sent to assistant teacher: ${assistantTeacher.user.id}`);
          }
        }
      } catch (notifErr) {
        console.warn('⚠️ Could not notify assistant teacher about essay grading:', notifErr.message);
      }
    }

    // If all auto-graded and no essays, create/update grade record
    if (!hasEssayQuestions) {
      const existingGrade = await prisma.grade.findFirst({
        where: { studentId: student.id, examId },
      });
      if (existingGrade) {
        await prisma.grade.update({
          where: { id: existingGrade.id },
          data:  { score: autoScore, gradedAt: now },
        });
      } else {
        await prisma.grade.create({
          data: {
            studentId: student.id,
            examId,
            score: autoScore,
            gradedAt: now,
          },
        });
      }
    }

    return {
      attemptId: updatedAttempt.id,
      score: hasEssayQuestions ? autoScore : autoScore,
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      isPassed,
      submittedAt: now,
      hasEssayQuestions,
      essayCount,
      autoScore,
      autoTotal,
      essayTotal,
      totalPossible,
      gradedDetails,
      // Notification text for student
      message: hasEssayQuestions
        ? `تم تصحيح ${autoTotal} درجة من الأسئلة التلقائية. الأسئلة المقالية (${essayCount}) لم يتم تصحيحها بعد وتحتاج إلى مراجعة المدرس.`
        : `تم تصحيح الاختبار تلقائياً. الدرجة: ${autoScore} من ${exam.totalMarks}`,
    };
  }

  // ── STUDENT: Get exam review (attempt + questions with correct answers) ─
  async getStudentReviewData(examId, userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('Student profile not found'), { statusCode: 404 });

    // Find the student's most recent submitted attempt for this exam
    const attempt = await prisma.examAttempt.findFirst({
      where: { examId, studentId: student.id, submittedAt: { not: null } },
      include: {
        exam: {
          include: {
            questions: { orderBy: { order: 'asc' } },
            course: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (!attempt) {
      throw Object.assign(new Error('لم يتم العثور على محاولة لهذا الاختبار'), { statusCode: 404 });
    }

    const { exam } = attempt;
    const answers = attempt.answers || {};
    const essayScores = answers._essayScores || {};

    // Build question-by-question breakdown
    const questionsDetailed = exam.questions.map((q) => {
      const studentAnswer = answers[q.id] ?? null;
      const isAutoGradable = ['multiple-choice', 'true-false', 'true/false', 'mcq'].includes((q.type || '').toLowerCase());
      const isEssay = (q.type || '').toLowerCase() === 'essay';
      const isEssayPending = isEssay && attempt.isPassed === null;

      let isCorrect = null;
      let marksAwarded = null;

      if (isAutoGradable && studentAnswer !== null) {
        isCorrect = studentAnswer === q.correctAnswer;
        marksAwarded = isCorrect ? q.marks : 0;
      } else if (isEssay && !isEssayPending) {
        // Essay has been graded — check the stored essay score
        const essayScore = essayScores[q.id];
        if (essayScore !== undefined) {
          marksAwarded = essayScore;
          // Consider correct if student got at least 50% of the marks
          isCorrect = essayScore >= q.marks * 0.5;
        }
      }

      return {
        id: q.id,
        type: q.type,
        questionText: q.questionText,
        options: q.options ?? [],
        marks: q.marks,
        correctAnswer: q.correctAnswer,
        studentAnswer,
        isCorrect,
        marksAwarded,
        isEssay,
        isAutoGradable,
        // For essay: pending if isPassed is null (essay hasn't been graded yet)
        pending: isEssayPending,
      };
    });

    return {
      attemptId: attempt.id,
      examId: exam.id,
      examTitle: exam.title,
      courseTitle: exam.course?.title ?? null,
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      score: attempt.score,
      isPassed: attempt.isPassed,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      finishedAt: attempt.finishedAt,
      questions: questionsDetailed,
      // Meta info
      hasEssayQuestions: questionsDetailed.some(q => q.isEssay),
      autoGradedCount: questionsDetailed.filter(q => q.isAutoGradable && q.studentAnswer !== null).length,
      essayCount: questionsDetailed.filter(q => q.isEssay).length,
    };
  }

  // ── Get stats for teacher's exams ─────────────────────────────
  async getExamStats(teacherId) {
    const exams = await prisma.exam.findMany({
      where: { teacherId },
      include: {
        attempts: {
          where: { submittedAt: { not: null } },
          select: { score: true, isPassed: true, submittedAt: true },
        },
        _count: { select: { attempts: true } },
      },
    });

    return exams.map(exam => {
      const submitted = exam.attempts.filter(a => a.submittedAt);
      const graded    = exam.attempts.filter(a => a.score !== null);
      const pending   = submitted.filter(a => a.score === null);
      const passed    = graded.filter(a => a.isPassed);
      const avgScore  = graded.length > 0
        ? graded.reduce((sum, a) => sum + (a.score || 0), 0) / graded.length
        : 0;

      return {
        examId:       exam.id,
        title:        exam.title,
        totalMarks:   exam.totalMarks,
        passingMarks: exam.passingMarks,
        submitted:    submitted.length,
        graded:       graded.length,
        pending:      pending.length,
        passed:       passed.length,
        avgScore:     Math.round(avgScore * 10) / 10,
        passRate:     graded.length > 0 ? Math.round((passed.length / graded.length) * 100) : 0,
      };
    });
  }

  // ── ASSISTANT TEACHER: Grade essay questions ────────────────
  async assistantGradeEssays(attemptId, assistantUserId, { essayScores }) {
    // Verify the assistant teacher
    const assistant = await prisma.teacher.findUnique({
      where: { userId: assistantUserId },
      select: { id: true, linkedTeacherId: true },
    });
    if (!assistant || !assistant.linkedTeacherId) {
      const err = new Error('Assistant teacher not linked to any teacher');
      err.statusCode = 403;
      throw err;
    }

    // Get the attempt with exam + questions
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: { questions: true },
        },
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!attempt) {
      const err = new Error('Attempt not found');
      err.statusCode = 404;
      throw err;
    }

    // Verify the assistant is linked to the exam's teacher
    // attempt.exam.teacherId is the Teacher.id (PK), same as assistant.linkedTeacherId
    if (assistant.linkedTeacherId !== attempt.exam.teacherId) {
      const err = new Error('Not authorized to grade this exam');
      err.statusCode = 403;
      throw err;
    }

    // Calculate essay score from submitted scores
    let essayScoreTotal = 0;
    const answers = attempt.answers || {};
    const essayScoresMap = {};

    for (const question of attempt.exam.questions) {
      const qType = (question.type || '').toLowerCase();
      if (qType === 'essay' && essayScores[question.id] !== undefined) {
        const score = Math.min(parseFloat(essayScores[question.id]), question.marks);
        essayScoresMap[question.id] = score;
        essayScoreTotal += score;
      }
    }

    // Store per-question essay scores in the answers JSON for later retrieval
    const updatedAnswers = {
      ...answers,
      _essayScores: {
        ...(answers._essayScores || {}),
        ...essayScoresMap,
      },
    };

    // Get the auto-graded score (already stored in attempt.score)
    const autoScore = attempt.score || 0;
    const totalScore = autoScore + essayScoreTotal;
    const isPassed = totalScore >= attempt.exam.passingMarks;

    // Update the attempt with final score and per-question essay scores
    const updated = await prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        answers: updatedAnswers,
        score: totalScore,
        isPassed,
        finishedAt: new Date(),
      },
    });

    // Create/update grade record
    const existingGrade = await prisma.grade.findFirst({
      where: { studentId: attempt.studentId, examId: attempt.examId },
    });
    if (existingGrade) {
      await prisma.grade.update({
        where: { id: existingGrade.id },
        data: { score: totalScore, gradedAt: new Date() },
      });
    } else {
      await prisma.grade.create({
        data: {
          studentId: attempt.studentId,
          examId: attempt.examId,
          score: totalScore,
          gradedAt: new Date(),
        },
      });
    }

    // Send notification to the student
    try {
      await notificationsService.create({
        userId: attempt.student.user.id,
        type: 'essay_graded',
        title: '📝 تم تقييم الأسئلة المقالية',
        body: `الأسئلة المقالية في اختبار "${attempt.exam.title}" تم تقييمها. هذه هي درجتك النهائية: ${totalScore} من ${attempt.exam.totalMarks}.`,
        data: {
          examId: attempt.examId,
          examTitle: attempt.exam.title,
          attemptId: attempt.id,
          finalScore: totalScore,
          totalMarks: attempt.exam.totalMarks,
          isPassed,
        },
      });
      console.log(`📨 Essay graded notification sent to student: ${attempt.student.user.id}`);
    } catch (notifErr) {
      console.warn('⚠️ Could not notify student about essay grading:', notifErr.message);
    }

    return {
      attemptId: updated.id,
      score: totalScore,
      autoScore,
      essayScore: essayScoreTotal,
      totalMarks: attempt.exam.totalMarks,
      passingMarks: attempt.exam.passingMarks,
      isPassed,
    };
  }
}

export default new AttemptsService();