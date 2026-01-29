import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Clear existing data (optional - remove in production)
  await prisma.examAttempt.deleteMany();
  await prisma.grade.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.option.deleteMany();
  await prisma.question.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.chatSession.deleteMany();
  await prisma.weaknessReport.deleteMany();
  await prisma.webrtcParticipant.deleteMany();
  await prisma.webrtcRecording.deleteMany();
  await prisma.webrtcRoom.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.course.deleteMany();
  await prisma.student.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.parent.deleteMany();
  await prisma.user.deleteMany();

  console.log('🗑️  Cleared existing data');

  // Hash password for demo users
  const hashedPassword = await bcrypt.hash('password123', 10);

  // Create Users
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@school.com',
      passwordHash: hashedPassword,
      role: 'admin',
      name: 'Admin User',
      phone: '+201234567890',
      isActive: true,
    },
  });

  const teacherUser1 = await prisma.user.create({
    data: {
      email: 'ahmed.hassan@school.com',
      passwordHash: hashedPassword,
      role: 'teacher',
      name: 'أحمد حسن',
      phone: '+201111111111',
      isActive: true,
    },
  });

  const teacherUser2 = await prisma.user.create({
    data: {
      email: 'fatma.mohamed@school.com',
      passwordHash: hashedPassword,
      role: 'teacher',
      name: 'فاطمة محمد',
      phone: '+201222222222',
      isActive: true,
    },
  });

  const studentUser1 = await prisma.user.create({
    data: {
      email: 'omar.ali@student.com',
      passwordHash: hashedPassword,
      role: 'student',
      name: 'عمر علي',
      phone: '+201333333333',
      isActive: true,
    },
  });

  const studentUser2 = await prisma.user.create({
    data: {
      email: 'sara.ibrahim@student.com',
      passwordHash: hashedPassword,
      role: 'student',
      name: 'سارة إبراهيم',
      phone: '+201444444444',
      isActive: true,
    },
  });

  const studentUser3 = await prisma.user.create({
    data: {
      email: 'khaled.mostafa@student.com',
      passwordHash: hashedPassword,
      role: 'student',
      name: 'خالد مصطفى',
      phone: '+201555555555',
      isActive: true,
    },
  });

  const parentUser1 = await prisma.user.create({
    data: {
      email: 'parent1@family.com',
      passwordHash: hashedPassword,
      role: 'parent',
      name: 'والد عمر',
      phone: '+201666666666',
      isActive: true,
    },
  });

  console.log('✅ Created users');

  // Create Teachers
  const teacher1 = await prisma.teacher.create({
    data: {
      userId: teacherUser1.id,
      bio: 'مدرس رياضيات بخبرة 10 سنوات في تدريس الثانوية العامة',
      expertise: 'Mathematics, Calculus',
      specialties: ['رياضيات', 'جبر', 'هندسة'],
      verified: true,
      ratingAvg: 4.8,
    },
  });

  const teacher2 = await prisma.teacher.create({
    data: {
      userId: teacherUser2.id,
      bio: 'مدرسة فيزياء متخصصة في المناهج المصرية والدولية',
      expertise: 'Physics, Science',
      specialties: ['فيزياء', 'كيمياء', 'علوم'],
      verified: true,
      ratingAvg: 4.9,
    },
  });

  console.log('✅ Created teachers');

  // Create Students
  const student1 = await prisma.student.create({
    data: {
      userId: studentUser1.id,
      gradeLevel: 'Grade 12',
      stream: 'علمي رياضة',
      coins: 150,
    },
  });

  const student2 = await prisma.student.create({
    data: {
      userId: studentUser2.id,
      gradeLevel: 'Grade 11',
      stream: 'علمي علوم',
      coins: 200,
    },
  });

  const student3 = await prisma.student.create({
    data: {
      userId: studentUser3.id,
      gradeLevel: 'Grade 12',
      stream: 'علمي رياضة',
      coins: 100,
    },
  });

  console.log('✅ Created students');

  // Create Parent
  const parent1 = await prisma.parent.create({
    data: {
      userId: parentUser1.id,
    },
  });

  console.log('✅ Created parents');

  // Create Courses
  const mathCourse = await prisma.course.create({
    data: {
      teacherId: teacher1.id,
      title: 'رياضيات - الثانوية العامة',
      description: 'كورس شامل لرياضيات الثانوية العامة يغطي جميع الوحدات',
      thumbnail: 'https://example.com/math-thumb.jpg',
      price: 500,
      isPublished: true,
      isCompetitive: false,
    },
  });

  const physicsCourse = await prisma.course.create({
    data: {
      teacherId: teacher2.id,
      title: 'فيزياء - المرحلة الثانوية',
      description: 'دروس تفاعلية في الفيزياء مع تجارب عملية',
      thumbnail: 'https://example.com/physics-thumb.jpg',
      price: 450,
      isPublished: true,
      isCompetitive: true,
    },
  });

  const chemCourse = await prisma.course.create({
    data: {
      teacherId: teacher2.id,
      title: 'كيمياء - الصف الثاني الثانوي',
      description: 'منهج الكيمياء كامل بأسلوب مبسط',
      price: 400,
      isPublished: false,
    },
  });

  console.log('✅ Created courses');

  // Create Lessons
  const mathLesson1 = await prisma.lesson.create({
    data: {
      courseId: mathCourse.id,
      title: 'الدرس الأول: الأعداد المركبة',
      content: 'شرح مفصل للأعداد المركبة وخصائصها',
      summary: 'تعريف الأعداد المركبة والعمليات عليها',
      videoUrl: 'https://example.com/math-lesson1.mp4',
      order: 1,
      orderIndex: 1,
      isPublished: true,
    },
  });

  const mathLesson2 = await prisma.lesson.create({
    data: {
      courseId: mathCourse.id,
      title: 'الدرس الثاني: الاقترانات',
      content: 'أنواع الاقترانات وخصائصها',
      summary: 'الاقترانات الخطية والتربيعية',
      videoUrl: 'https://example.com/math-lesson2.mp4',
      order: 2,
      orderIndex: 2,
      isPublished: true,
    },
  });

  const physicsLesson1 = await prisma.lesson.create({
    data: {
      courseId: physicsCourse.id,
      title: 'الحركة في خط مستقيم',
      content: 'السرعة والتسارع والحركة المنتظمة',
      videoUrl: 'https://example.com/physics-lesson1.mp4',
      order: 1,
      orderIndex: 1,
      isPublished: true,
    },
  });

  console.log('✅ Created lessons');

  // Create Enrollments
  const enrollment1 = await prisma.enrollment.create({
    data: {
      studentId: student1.id,
      courseId: mathCourse.id,
      progress: 50,
    },
  });

  const enrollment2 = await prisma.enrollment.create({
    data: {
      studentId: student2.id,
      courseId: physicsCourse.id,
      progress: 30,
    },
  });

  const enrollment3 = await prisma.enrollment.create({
    data: {
      studentId: student3.id,
      courseId: mathCourse.id,
      progress: 70,
    },
  });

  console.log('✅ Created enrollments');

  // Create Exams
  const mathExam = await prisma.exam.create({
    data: {
      courseId: mathCourse.id,
      teacherId: teacher1.id,
      title: 'امتحان الوحدة الأولى',
      description: 'امتحان شامل على الأعداد المركبة والاقترانات',
      duration: 60,
      durationMinutes: 60,
      totalMarks: 50,
      passingMarks: 25,
      proctored: true,
      isPublished: true,
      availableFrom: new Date('2025-01-15'),
      availableTo: new Date('2025-01-30'),
    },
  });

  const physicsExam = await prisma.exam.create({
    data: {
      courseId: physicsCourse.id,
      teacherId: teacher2.id,
      title: 'اختبار الحركة',
      description: 'اختبار قصير على الحركة في خط مستقيم',
      duration: 30,
      durationMinutes: 30,
      totalMarks: 30,
      passingMarks: 15,
      proctored: false,
      isPublished: true,
    },
  });

  console.log('✅ Created exams');

  // Create Questions
  const question1 = await prisma.question.create({
    data: {
      examId: mathExam.id,
      type: 'multiple_choice',
      questionText: 'ما هو ناتج ضرب (2 + 3i) × (1 - i)؟',
      body: 'احسب ناتج الضرب',
      qtype: 'mcq',
      marks: 5,
      points: 5,
      order: 1,
      options: JSON.stringify([
        { id: 'a', text: '5 - i', isCorrect: false },
        { id: 'b', text: '5 + i', isCorrect: true },
        { id: 'c', text: '-1 + 5i', isCorrect: false },
        { id: 'd', text: '2 - 2i', isCorrect: false },
      ]),
      correctAnswer: 'b',
    },
  });

  // Create Options for question1
  await prisma.option.createMany({
    data: [
      { questionId: question1.id, optionText: '5 - i', isCorrect: false },
      { questionId: question1.id, optionText: '5 + i', isCorrect: true },
      { questionId: question1.id, optionText: '-1 + 5i', isCorrect: false },
      { questionId: question1.id, optionText: '2 - 2i', isCorrect: false },
    ],
  });

  const question2 = await prisma.question.create({
    data: {
      examId: mathExam.id,
      type: 'true_false',
      questionText: 'هل مجموع عددين مركبين هو عدد مركب؟',
      qtype: 'true_false',
      marks: 3,
      points: 3,
      order: 2,
      correctAnswer: 'true',
    },
  });

  const question3 = await prisma.question.create({
    data: {
      examId: physicsExam.id,
      type: 'multiple_choice',
      questionText: 'ما هي وحدة قياس التسارع؟',
      qtype: 'mcq',
      marks: 5,
      points: 5,
      order: 1,
      correctAnswer: 'c',
    },
  });

  await prisma.option.createMany({
    data: [
      { questionId: question3.id, optionText: 'm/s', isCorrect: false },
      { questionId: question3.id, optionText: 'm', isCorrect: false },
      { questionId: question3.id, optionText: 'm/s²', isCorrect: true },
      { questionId: question3.id, optionText: 'km/h', isCorrect: false },
    ],
  });

  console.log('✅ Created questions and options');

  // Create Exam Attempts
  const attempt1 = await prisma.examAttempt.create({
    data: {
      examId: mathExam.id,
      studentId: student1.id,
      answers: JSON.stringify({
        q1: 'b',
        q2: 'true',
      }),
      score: 8,
      isPassed: true,
      submittedAt: new Date(),
      finishedAt: new Date(),
    },
  });

  const attempt2 = await prisma.examAttempt.create({
    data: {
      examId: physicsExam.id,
      studentId: student2.id,
      answers: JSON.stringify({
        q1: 'c',
      }),
      score: 5,
      isPassed: true,
      submittedAt: new Date(),
    },
  });

  console.log('✅ Created exam attempts');

  // Create Grades
  await prisma.grade.create({
    data: {
      studentId: student1.id,
      examId: mathExam.id,
      score: 40,
      gradeLetter: 'A',
    },
  });

  await prisma.grade.create({
    data: {
      studentId: student2.id,
      examId: physicsExam.id,
      score: 25,
      gradeLetter: 'B',
    },
  });

  console.log('✅ Created grades');

  // Create Attendance
  await prisma.attendance.createMany({
    data: [
      {
        studentId: student1.id,
        lessonId: mathLesson1.id,
        attendDate: new Date('2025-01-10'),
        present: true,
      },
      {
        studentId: student1.id,
        lessonId: mathLesson2.id,
        attendDate: new Date('2025-01-12'),
        present: true,
      },
      {
        studentId: student2.id,
        lessonId: physicsLesson1.id,
        attendDate: new Date('2025-01-11'),
        present: false,
      },
    ],
  });

  console.log('✅ Created attendance records');

  // Create Meetings
  await prisma.meeting.create({
    data: {
      hostTeacherId: teacher1.id,
      meetingLink: 'https://meet.google.com/abc-defg-hij',
      startTime: new Date('2025-01-25T10:00:00'),
      endTime: new Date('2025-01-25T11:00:00'),
      description: 'مراجعة نهائية قبل الامتحان',
    },
  });

  console.log('✅ Created meetings');

  // Create WebRTC Rooms
  const webrtcRoom = await prisma.webrtcRoom.create({
    data: {
      roomName: 'math-live-class-001',
      courseId: mathCourse.id,
      hostId: teacher1.id,
      roomType: 'class',
      isActive: true,
      maxCapacity: 50,
      startedAt: new Date(),
    },
  });

  console.log('✅ Created WebRTC rooms');

  // Create WebRTC Participants
  await prisma.webrtcParticipant.createMany({
    data: [
      {
        roomId: webrtcRoom.id,
        userId: teacherUser1.id,
        peerId: 'peer-teacher-001',
        role: 'host',
        isConnected: true,
        audioEnabled: true,
        videoEnabled: true,
        screenShare: false,
      },
      {
        roomId: webrtcRoom.id,
        userId: studentUser1.id,
        peerId: 'peer-student-001',
        role: 'participant',
        isConnected: true,
        audioEnabled: true,
        videoEnabled: false,
        screenShare: false,
      },
    ],
  });

  console.log('✅ Created WebRTC participants');

  // Create Chat Sessions
  const chatSession1 = await prisma.chatSession.create({
    data: {
      studentId: student1.id,
      sessionType: 'homework_help',
      lastActive: new Date(),
    },
  });

  console.log('✅ Created chat sessions');

  // Create Chat Messages
  await prisma.chatMessage.createMany({
    data: [
      {
        sessionId: chatSession1.id,
        senderUserId: studentUser1.id,
        message: 'مرحباً، أحتاج مساعدة في حل مسألة',
      },
      {
        sessionId: chatSession1.id,
        senderUserId: teacherUser1.id,
        message: 'أهلاً عمر، تفضل أرسل المسألة',
      },
    ],
  });

  console.log('✅ Created chat messages');

  // Create Weakness Reports
  await prisma.weaknessReport.create({
    data: {
      studentId: student1.id,
      courseId: mathCourse.id,
      topic: 'الأعداد المركبة - القسمة',
      severityScore: 7.5,
      recommendedActions: 'مراجعة الدرس الأول ومشاهدة الفيديو التوضيحي، حل تمارين إضافية',
    },
  });

  console.log('✅ Created weakness reports');

  console.log('');
  console.log('🎉 Database seeding completed successfully!');
  console.log('');
  console.log('📊 Summary:');
  console.log('   - Users: 7 (1 admin, 2 teachers, 3 students, 1 parent)');
  console.log('   - Courses: 3');
  console.log('   - Lessons: 3');
  console.log('   - Exams: 2');
  console.log('   - Questions: 3');
  console.log('   - Enrollments: 3');
  console.log('   - Exam Attempts: 2');
  console.log('   - Grades: 2');
  console.log('   - Attendance: 3');
  console.log('   - Meetings: 1');
  console.log('   - WebRTC Rooms: 1');
  console.log('   - Chat Sessions: 1');
  console.log('   - Weakness Reports: 1');
  console.log('');
  console.log('🔑 Demo Login Credentials:');
  console.log('   Email: admin@school.com | Password: password123');
  console.log('   Email: ahmed.hassan@school.com | Password: password123');
  console.log('   Email: omar.ali@student.com | Password: password123');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });