// backend/src/modules/analytics/analytics.service.js

import prisma from '../../config/prisma.config.js';
import OpenAI from 'openai';

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_ANALYSIS_KEY = process.env.GROQ_TEACHER_ANALSYS_API_KEY;

function createGroqClient() {
  if (!GROQ_ANALYSIS_KEY) {
    throw new Error('GROQ_TEACHER_ANALSYS_API_KEY is not configured');
  }
  return new OpenAI({ apiKey: GROQ_ANALYSIS_KEY, baseURL: GROQ_BASE_URL });
}

class AnalyticsService {

  // ── Teacher overall report ────────────────────────────────────
  async getTeacherReport(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });

    const [courses, attempts, enrollments] = await Promise.all([
      prisma.course.findMany({
        where: { teacherId: teacher.id },
        include: {
          _count: { select: { enrollments: true, lessons: true, exams: true } },
        },
      }),
      prisma.examAttempt.findMany({
        where: {
          exam: { teacherId: teacher.id },
          submittedAt: { not: null },
          score: { not: null },
        },
        select: { score: true, isPassed: true, submittedAt: true, exam: { select: { totalMarks: true } } },
      }),
      prisma.enrollment.findMany({
        where: { course: { teacherId: teacher.id } },
        select: { enrolledAt: true },
      }),
    ]);

    const totalStudents   = enrollments.length;
    const totalCourses    = courses.length;
    const publishedCourses = courses.filter(c => c.isPublished).length;
    const totalExams      = courses.reduce((s, c) => s + c._count.exams, 0);
    const totalLessons    = courses.reduce((s, c) => s + c._count.lessons, 0);

    const gradedAttempts  = attempts.filter(a => a.score !== null);
    const passedAttempts  = attempts.filter(a => a.isPassed);
    const avgScore = gradedAttempts.length > 0
      ? gradedAttempts.reduce((s, a) => s + (a.score || 0), 0) / gradedAttempts.length
      : 0;
    const passRate = gradedAttempts.length > 0
      ? (passedAttempts.length / gradedAttempts.length) * 100
      : 0;

    // Enrollment trend (last 6 months)
    const now = new Date();
    const enrollmentTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString('ar-EG', { month: 'long' });
      const count = enrollments.filter(e => {
        const ed = new Date(e.enrolledAt);
        return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
      }).length;
      enrollmentTrend.push({ month: label, students: count });
    }

    // Score distribution
    const scoreDist = [
      { label: 'ممتاز (90-100)', min: 90, max: 100, color: '#059669' },
      { label: 'جيد جداً (80-89)', min: 80, max: 89, color: '#2563eb' },
      { label: 'جيد (70-79)', min: 70, max: 79, color: '#f59e0b' },
      { label: 'مقبول (60-69)', min: 60, max: 69, color: '#dc2626' },
      { label: 'راسب (أقل من 60)', min: 0, max: 59, color: '#991b1b' },
    ].map(band => {
      const count = gradedAttempts.filter(a => {
        if (!a.exam?.totalMarks || !a.score) return false;
        const pct = (a.score / a.exam.totalMarks) * 100;
        return pct >= band.min && pct <= band.max;
      }).length;
      return { name: band.label, value: count, color: band.color };
    });

    // Top students
    const studentScores = {};
    for (const a of gradedAttempts) {
      // We'd need studentId — fetch separately for top students
    }

    // Top students via separate query
    const topStudentsRaw = await prisma.examAttempt.groupBy({
      by: ['studentId'],
      where: { exam: { teacherId: teacher.id }, score: { not: null } },
      _avg: { score: true },
      _count: { id: true },
      orderBy: { _avg: { score: 'desc' } },
      take: 5,
    });

    const topStudents = await Promise.all(
      topStudentsRaw.map(async (s) => {
        const student = await prisma.student.findUnique({
          where: { id: s.studentId },
          include: { user: { select: { name: true, avatar: true } } },
        });
        return {
          name: student?.user?.name || 'مجهول',
          avatar: student?.user?.name?.[0] || '؟',
          avgScore: Math.round((s._avg.score || 0) * 10) / 10,
          examsCount: s._count.id,
        };
      })
    );

    // Course performance
    const coursePerformance = courses.map(c => ({
      name: c.title.length > 20 ? c.title.slice(0, 20) + '...' : c.title,
      students: c._count.enrollments,
    }));

    return {
      summary: {
        totalStudents,
        totalCourses,
        publishedCourses,
        totalExams,
        totalLessons,
        avgScore: Math.round(avgScore * 10) / 10,
        passRate: Math.round(passRate),
        totalAttempts: gradedAttempts.length,
      },
      enrollmentTrend,
      scoreDist,
      topStudents,
      coursePerformance,
    };
  }

  // ── Teacher export data (for Excel) ────────────────────────────
  async getTeacherExportData(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });

    const [courses, exams, enrollments, attempts] = await Promise.all([
      prisma.course.findMany({
        where: { teacherId: teacher.id },
        include: { _count: { select: { enrollments: true, lessons: true, exams: true } } },
      }),
      prisma.exam.findMany({
        where: { teacherId: teacher.id },
        include: { _count: { select: { attempts: true } }, course: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.enrollment.findMany({
        where: { course: { teacherId: teacher.id } },
        include: { student: { include: { user: { select: { name: true, email: true } } } }, course: { select: { title: true } } },
      }),
      prisma.examAttempt.findMany({
        where: { exam: { teacherId: teacher.id }, score: { not: null } },
        include: { exam: { select: { title: true, totalMarks: true } }, student: { include: { user: { select: { name: true } } } } },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    return { courses, exams, enrollments, attempts };
  }

  // ── AI course analysis ────────────────────────────────────────
  async analyzeCourse(userId, courseId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });

    const course = await prisma.course.findFirst({
      where: { id: courseId, teacherId: teacher.id },
      include: { teacher: { select: { id: true, userId: true } } },
    });
    if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 });

    // Collect all course data
    const [enrollments, examAttempts, assignments, lessons, weaknessReports, lessonRatings, courseRatings] =
      await Promise.all([
        // Enrolled students
        prisma.enrollment.findMany({
          where: { courseId },
          include: {
            student: {
              include: { user: { select: { name: true, email: true } } },
            },
          },
        }),

        // Exam attempts
        prisma.examAttempt.findMany({
          where: {
            exam: { courseId },
            submittedAt: { not: null },
            score: { not: null },
          },
          include: {
            exam: { select: { title: true, totalMarks: true, passingMarks: true } },
            student: { include: { user: { select: { name: true } } } },
          },
          orderBy: { submittedAt: 'desc' },
        }),

        // Assignments + submissions
        prisma.assignment.findMany({
          where: { courseId },
          include: {
            submissions: {
              include: { student: { include: { user: { select: { name: true } } } } },
            },
            _count: { select: { submissions: true } },
          },
        }),

        // Lessons
        prisma.lesson.findMany({
          where: { courseId, isPublished: true },
          include: { _count: { select: { attendances: true } } },
          orderBy: { order: 'asc' },
        }),

        // Weakness reports
        prisma.weaknessReport.findMany({
          where: { courseId },
          include: { student: { include: { user: { select: { name: true } } } } },
        }),

        // Lesson ratings for this course's lessons
        prisma.lessonRating.findMany({
          where: { lesson: { courseId } },
          include: { lesson: { select: { title: true } } },
        }),

        // Course ratings
        prisma.courseRating.findMany({
          where: { courseId },
          include: { student: { include: { user: { select: { name: true } } } } },
        }),
      ]);

    // Attendance summary per lesson
    const attendanceSummary = lessons.map(l => ({
      lessonTitle: l.title,
      totalSessions: l._count.attendances,
      uniqueStudents: enrollments.length,
    }));

    // Per-student aggregates
    const studentData = enrollments.map(e => {
      const studentExams = examAttempts.filter(a => a.studentId === e.studentId);
      const studentAssignments = assignments.flatMap(a =>
        a.submissions.filter(s => s.studentId === e.studentId)
      );
      const studentWeaknesses = weaknessReports.filter(w => w.studentId === e.studentId);

      const avgScore = studentExams.length > 0
        ? studentExams.reduce((s, a) => s + (a.score || 0), 0) / studentExams.length
        : null;
      const totalMarks = studentExams.reduce((s, a) => s + (a.exam?.totalMarks || 0), 0);
      const overallPct = totalMarks > 0
        ? Math.round((studentExams.reduce((s, a) => s + (a.score || 0), 0) / totalMarks) * 100)
        : null;

      return {
        name: e.student?.user?.name || 'Unknown',
        progress: e.progress,
        enrolledAt: e.enrolledAt,
        examsTaken: studentExams.length,
        avgExamScore: avgScore != null ? Math.round(avgScore * 10) / 10 : null,
        overallPercentage: overallPct,
        assignmentsSubmitted: studentAssignments.length,
        weaknesses: studentWeaknesses.map(w => ({ topic: w.topic, severity: w.severityScore })),
        passed: studentExams.filter(a => a.isPassed).length,
        failed: studentExams.filter(a => !a.isPassed).length,
      };
    });

    // Course-wide aggregates
    const totalExams = await prisma.exam.count({ where: { courseId } });
    const passedAttempts = examAttempts.filter(a => a.isPassed).length;
    const passRate = examAttempts.length > 0
      ? Math.round((passedAttempts / examAttempts.length) * 100)
      : 0;
    const avgScoreAll = examAttempts.length > 0
      ? Math.round((examAttempts.reduce((s, a) => s + (a.score || 0), 0) / examAttempts.length) * 10) / 10
      : 0;
    const avgProgress = enrollments.length > 0
      ? Math.round(enrollments.reduce((s, e) => s + (e.progress || 0), 0) / enrollments.length)
      : 0;

    // Lesson rating average
    const avgLessonRating = lessonRatings.length > 0
      ? Math.round((lessonRatings.reduce((s, r) => s + r.rating, 0) / lessonRatings.length) * 10) / 10
      : 0;

    // Course rating average
    const avgCourseRating = courseRatings.length > 0
      ? Math.round((courseRatings.reduce((s, r) => s + r.rating, 0) / courseRatings.length) * 10) / 10
      : 0;

    // Weakness topics aggregated
    const weaknessTopics = {};
    weaknessReports.forEach(w => {
      if (!weaknessTopics[w.topic]) weaknessTopics[w.topic] = { count: 0, totalSeverity: 0 };
      weaknessTopics[w.topic].count++;
      weaknessTopics[w.topic].totalSeverity += w.severityScore || 0;
    });

    const promptData = {
      courseTitle: course.title,
      courseDescription: course.description || '',
      totalStudents: enrollments.length,
      totalExams,
      totalLessons: lessons.length,
      totalAssignments: assignments.length,
      passRate: `${passRate}%`,
      averageExamScore: avgScoreAll,
      averageProgress: `${avgProgress}%`,
      averageLessonRating: avgLessonRating,
      averageCourseRating: avgCourseRating,
      lessonCount: lessons.length,
      examCount: totalExams,
      assignmentCount: assignments.length,
      scoreDistribution: {
        excellent: examAttempts.filter(a => a.exam?.totalMarks && ((a.score / a.exam.totalMarks) * 100) >= 90).length,
        good: examAttempts.filter(a => a.exam?.totalMarks && ((a.score / a.exam.totalMarks) * 100) >= 80 && ((a.score / a.exam.totalMarks) * 100) < 90).length,
        average: examAttempts.filter(a => a.exam?.totalMarks && ((a.score / a.exam.totalMarks) * 100) >= 70 && ((a.score / a.exam.totalMarks) * 100) < 80).length,
        poor: examAttempts.filter(a => a.exam?.totalMarks && ((a.score / a.exam.totalMarks) * 100) >= 60 && ((a.score / a.exam.totalMarks) * 100) < 70).length,
        failing: examAttempts.filter(a => a.exam?.totalMarks && ((a.score / a.exam.totalMarks) * 100) < 60).length,
      },
      strugglingTopics: Object.entries(weaknessTopics)
        .map(([topic, data]) => ({
          topic,
          studentCount: data.count,
          avgSeverity: Math.round((data.totalSeverity / data.count) * 10) / 10,
        }))
        .sort((a, b) => b.avgSeverity - a.avgSeverity),
      topStudents: studentData
        .filter(s => s.overallPercentage != null)
        .sort((a, b) => (b.overallPercentage || 0) - (a.overallPercentage || 0))
        .slice(0, 5),
      studentsNeedingHelp: studentData
        .filter(s => s.overallPercentage != null && s.overallPercentage < 60)
        .sort((a, b) => (a.overallPercentage || 0) - (b.overallPercentage || 0))
        .slice(0, 5),
    };

    const systemPrompt = `أنت خبير تربوي محترف بخبرة تزيد عن 60 عامًا في التدريس والتعليم. قم بتحليل بيانات الكورس التالية وقدم تقريرًا شاملاً باللغة العربية الفصحى.

يجب أن يكون الرد بصيغة JSON فقط يحتوي على الحقول التالية دون أي تنسيق إضافي:
{
  "overallAssessment": "تقييم عام للمستوى",
  "strengths": ["نقطة قوة 1", "نقطة قوة 2"],
  "weaknesses": ["نقطة ضعف 1", "نقطة ضعف 2"],
  "strugglingTopics": [
    { "topic": "اسم الموضوع", "analysis": "تحليل المشكلة", "recommendation": "توصية للحل" }
  ],
  "performanceSuggestions": ["اقتراح 1", "اقتراح 2"],
  "engagementStrategies": ["استراتيجية 1", "استراتيجية 2"],
  "teachingMethodImprovements": ["تحسين 1", "تحسين 2"],
  "studentSuccessStrategies": ["استراتيجية 1", "استراتيجية 2"],
  "personalizedRecommendations": ["توصية 1", "توصية 2"],
  "teachingTips": [
    { "tip": "نصيحة 1", "context": "سياق النصيحة" }
  ],
  "recommendedActions": [
    { "action": "إجراء مقترح", "priority": "عالي/متوسط/منخفض", "expectedImpact": "الأثر المتوقع" }
  ]
}

اجعل الرد دقيقًا ومفيدًا بناءً على البيانات المقدمة فقط. لا تخترع بيانات غير موجودة.`;

    const userPrompt = `قم بتحليل بيانات الكورس التالية وقدم تقريرًا شاملاً:

=== معلومات الكورس ===
العنوان: ${promptData.courseTitle}
الوصف: ${promptData.courseDescription}
عدد الطلاب: ${promptData.totalStudents}
عدد الاختبارات: ${promptData.totalExams}
عدد الدروس: ${promptData.totalLessons}
عدد الواجبات: ${promptData.totalAssignments}

=== مؤشرات الأداء ===
معدل النجاح: ${promptData.passRate}
متوسط درجات الاختبارات: ${promptData.averageExamScore}
متوسط تقدم الطلاب: ${promptData.averageProgress}
متوسط تقييم الدروس: ${promptData.averageLessonRating}
متوسط تقييم الكورس: ${promptData.averageCourseRating}

=== توزيع الدرجات ===
ممتاز (90%+): ${promptData.scoreDistribution.excellent}
جيد (80-89%): ${promptData.scoreDistribution.good}
متوسط (70-79%): ${promptData.scoreDistribution.average}
ضعيف (60-69%): ${promptData.scoreDistribution.poor}
راسب (<60%): ${promptData.scoreDistribution.failing}

=== المواضيع الصعبة ===
${JSON.stringify(promptData.strugglingTopics, null, 2)}

=== أفضل 5 طلاب ===
${JSON.stringify(promptData.topStudents, null, 2)}

=== الطلاب الذين يحتاجون مساعدة ===
${JSON.stringify(promptData.studentsNeedingHelp, null, 2)}`;

    const client = createGroqClient();

    try {
      const completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        temperature: 0.4,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const raw = completion?.choices?.[0]?.message?.content || '';
      let analysis;
      try {
        analysis = JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try { analysis = JSON.parse(match[0]); } catch { analysis = null; }
        } else {
          analysis = null;
        }
      }

      if (!analysis) {
        throw new Error('AI returned unparseable response');
      }

      return {
        courseId,
        courseTitle: course.title,
        analyzedAt: new Date().toISOString(),
        summary: promptData,
        analysis,
        usage: completion?.usage || null,
      };
    } catch (error) {
      console.error('❌ AI Course Analysis error:', error.message);
      throw new Error(error.message || 'فشل تحليل الكورس بالذكاء الاصطناعي');
    }
  }

  // ── Student performance detail ────────────────────────────────
  async getStudentPerformance(teacherId, studentId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherId } });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });

    const attempts = await prisma.examAttempt.findMany({
      where: {
        studentId,
        exam: { teacherId: teacher.id },
        submittedAt: { not: null },
      },
      include: {
        exam: { select: { title: true, totalMarks: true, passingMarks: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });

    return attempts.map(a => ({
      examTitle: a.exam.title,
      score: a.score,
      totalMarks: a.exam.totalMarks,
      isPassed: a.isPassed,
      percentage: a.exam.totalMarks ? Math.round(((a.score || 0) / a.exam.totalMarks) * 100) : 0,
      submittedAt: a.submittedAt,
    }));
  }
}

export default new AnalyticsService();