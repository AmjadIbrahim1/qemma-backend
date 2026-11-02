// Script: test the /api/exams/student endpoint
// Usage: node scripts/test-exams-api.js

import prisma from '../src/config/prisma.config.js';
import { generateToken } from '../src/shared/utils/jwt.util.js';

async function main() {
  console.log('=== Testing /api/exams/student ===\n');

  // 1. Find a student user with enrollments
  const student = await prisma.student.findFirst({
    include: {
      user: {
        select: { id: true, email: true, name: true, role: true },
      },
      enrollments: {
        include: {
          course: {
            include: {
              exams: {
                where: { isPublished: true },
                select: { id: true, title: true, isPublished: true },
              },
            },
          },
        },
      },
    },
  });

  if (!student) {
    console.log('No student found in the database.');
    console.log('Checking all users...');
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true },
    });
    console.log(`Total users: ${users.length}`);
    users.forEach((u) => console.log(`  - ${u.email} (${u.name}) [${u.role}]`));
    return;
  }

  console.log(`Student found: ${student.user.name} (${student.user.email})`);
  console.log(`Student ID: ${student.id}`);
  console.log(`Enrollments: ${student.enrollments.length}`);

  if (student.enrollments.length === 0) {
    console.log('No enrollments for this student.');
    console.log('Checking all enrollments...');
    const allEnrollments = await prisma.enrollment.findMany({
      include: { student: { select: { userId: true } }, course: { select: { title: true } } },
    });
    console.log(`Total enrollments: ${allEnrollments.length}`);
    allEnrollments.forEach((e) =>
      console.log(`  - Student ${e.student.userId} → Course "${e.course.title}"`)
    );
    return;
  }

  for (const enrollment of student.enrollments) {
    console.log(`\n  Course: "${enrollment.course.title}" (${enrollment.course.id})`);
    const exams = enrollment.course.exams;
    if (exams.length === 0) {
      console.log('    → No published exams in this course.');
    } else {
      exams.forEach((ex) => console.log(`    → Exam: "${ex.title}" (published: ${ex.isPublished})`));
    }
  }

  // 2. Check all published exams in the DB
  const allPublishedExams = await prisma.exam.findMany({
    where: { isPublished: true },
    include: { course: { select: { title: true } } },
  });
  console.log(`\nTotal published exams in DB: ${allPublishedExams.length}`);
  allPublishedExams.forEach((ex) =>
    console.log(`  - "${ex.title}" in course "${ex.course.title}"`)
  );

  // 3. Generate a token for this student
  const token = generateToken({
    userId: student.user.id,
    email: student.user.email,
    role: student.user.role,
    authProvider: 'local',
  });
  console.log(`\nGenerated JWT token (first 80 chars): ${token.substring(0, 80)}...`);

  // 4. Call the endpoint
  console.log('\n--- Calling /api/exams/student ---');
  try {
    const response = await fetch('http://localhost:5000/api/exams/student', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    console.log(`Status: ${response.status}`);
    console.log(`Success: ${data.success}`);
    if (data.data) {
      console.log(`Exams returned: ${data.data.length}`);
      data.data.forEach((ex) => {
        console.log(`  - "${ex.title}" | Course: ${ex.courseTitle} | Duration: ${ex.durationMinutes}min | Marks: ${ex.totalMarks} | Published: ${ex.isPublished} | Available: ${ex.isAvailable} | Questions: ${ex.questionsCount} | Attempts: ${ex.attemptsCount} | Completed: ${ex.hasCompleted}`);
      });
    } else {
      console.log('Response:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('Request failed:', err.message);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Script error:', err);
  prisma.$disconnect();
});
