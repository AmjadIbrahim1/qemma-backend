// backend/test-contests-flow.js
// ✅ End-to-end test script for the two contest features (no test framework — plain Node).
// Run: node test-contests-flow.js
// Exercises: (1) teacher add-questions flow, (2) student participation flow (per-question + final submit).
// Handles the seeded test-data gap by inserting a temporary active Science-Maths contest with a question.

import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const API = 'http://localhost:5000/api';
let pass = 0, fail = 0;
const log = (ok, msg) => { if (ok) { pass++; console.log(`  ✅ ${msg}`); } else { fail++; console.log(`  ❌ ${msg}`); } };

// ── tiny fetch helper ──
const req = async (method, path, token, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const login = async (email, password = 'password123') => {
  const r = await req('POST', '/auth/login', null, { email, password });
  return r.data?.data?.token || null;
};

// ── PART A: TEACHER — add questions to the upcoming contest ──
async function testTeacherFlow() {
  console.log('\n=== PART A: TEACHER — Add Questions ===');
  const token = await login('ahmed.hassan@school.com');
  log(!!token, 'Login as teacher (ahmed.hassan@school.com)');

  // GET /contests/teacher — should list the upcoming Science-Maths contest
  const list = await req('GET', '/contests/teacher', token);
  log(list.status === 200, `GET /contests/teacher → 200 (got ${list.status})`);
  const contests = list.data?.data || [];
  log(contests.length > 0, `Teacher sees upcoming contest(s) (${contests.length})`);
  const upcoming = contests.find(c => c.stream === 'Science-Maths');
  log(!!upcoming, 'Found upcoming Science-Maths contest');

  if (!upcoming) return;

  // GET /contests/:id — contest detail
  const detail = await req('GET', `/contests/${upcoming.id}`, token);
  log(detail.status === 200, `GET /contests/:id → 200`);

  // POST a question
  const addQ = await req('POST', `/contests/${upcoming.id}/questions`, token, {
    text: 'ما هو مشتقة x^2؟',
    pointValue: 5,
    options: [
      { text: '2x', isCorrect: true },
      { text: 'x', isCorrect: false },
      { text: 'x^2', isCorrect: false },
      { text: '2', isCorrect: false },
    ],
  });
  log(addQ.status === 201, `POST question → 201 (got ${addQ.status})`);
  const qId = addQ.data?.data?.id;
  log(!!qId, 'Question created with id');

  // Verify it appears in GET /contests/:id/questions
  const qList = await req('GET', `/contests/${upcoming.id}/questions`, token);
  const found = (qList.data?.data || []).some(q => q.id === qId);
  log(found, 'Added question appears in question list (with isCorrect)');

  // Test validation: missing text → 400
  const badQ = await req('POST', `/contests/${upcoming.id}/questions`, token, { text: '', pointValue: 5, options: [{text:'a',isCorrect:true},{text:'b',isCorrect:false}] });
  log(badQ.status === 400, `Empty text rejected → 400 (got ${badQ.status})`);

  // Test validation: 2 correct options → 400
  const badQ2 = await req('POST', `/contests/${upcoming.id}/questions`, token, { text: 'test', pointValue: 5, options: [{text:'a',isCorrect:true},{text:'b',isCorrect:true}] });
  log(badQ2.status === 400, `Two correct options rejected → 400 (got ${badQ2.status})`);

  // DELETE the question
  const del = await req('DELETE', `/contests/${upcoming.id}/questions/${qId}`, token);
  log(del.status === 200, `DELETE question → 200`);

  // Test stream authorization: fatma (science) can add to Science-Maths
  const fatmaToken = await login('fatma.mohamed@school.com');
  const addQ2 = await req('POST', `/contests/${upcoming.id}/questions`, fatmaToken, {
    text: 'فيزياء test', pointValue: 3,
    options: [{text:'a',isCorrect:true},{text:'b',isCorrect:false}],
  });
  log(addQ2.status === 201, `fatma (science stream) can add to Science-Maths contest → 201 (got ${addQ2.status})`);
  if (addQ2.data?.data?.id) await req('DELETE', `/contests/${upcoming.id}/questions/${addQ2.data.data.id}`, fatmaToken);
}

// ── PART B: STUDENT — participation (per-question + final submit) ──
async function testStudentFlow() {
  console.log('\n=== PART B: STUDENT — Participation ===');

  // Insert a temporary ACTIVE Science-Maths contest WITH a question (seeded active contest is Science-Biology
  // with no eligible 3rd-year student, so we create one matching omar's stream).
  const now = new Date();
  const tempContest = await p.contest.create({
    data: { title: 'TEST: مسابقة رياضيات نشطة', stream: 'Science-Maths', difficulty: 'Easy', duration: 60, startTime: new Date(now.getTime() - 5*60*1000), questionCount: 1 },
  });
  const tempQ = await p.contestQuestion.create({
    data: { contestId: tempContest.id, text: 'كم يساوي 2+2؟', pointValue: 10 },
  });
  await p.contestOption.createMany({
    data: [
      { contestQuestionId: tempQ.id, text: '3', isCorrect: false },
      { contestQuestionId: tempQ.id, text: '4', isCorrect: true },
      { contestQuestionId: tempQ.id, text: '5', isCorrect: false },
    ],
  });
  console.log(`  ℹ️  Created temp active contest: ${tempContest.id}`);

  try {
    const token = await login('omar.ali@student.com');
    log(!!token, 'Login as student (omar.ali@student.com)');

    // GET /contests/available — should see the active Science-Maths contest
    const avail = await req('GET', '/contests/available', token);
    log(avail.status === 200, `GET /contests/available → 200 (got ${avail.status})`);
    const availContests = avail.data?.data || [];
    const found = availContests.some(c => c.id === tempContest.id);
    log(found, 'Student sees the active Science-Maths contest');

    // POST /contests/:id/start
    const start = await req('POST', `/contests/${tempContest.id}/start`, token);
    log(start.status === 200, `POST /start → 200 (got ${start.status})`);
    const questions = start.data?.data?.questions || [];
    log(questions.length === 1, `Got 1 question (got ${questions.length})`);
    // Verify isCorrect is NOT exposed (no feedback during contest)
    const hasCorrect = questions[0]?.options?.some(o => 'isCorrect' in o);
    log(!hasCorrect, 'isCorrect NOT exposed to student (no feedback)');

    const qId = questions[0]?.id;
    const correctOpt = questions[0]?.options?.[1]?.id;  // we know index 1 is correct
    const wrongOpt = questions[0]?.options?.[0]?.id;

    // Per-question submit (correct answer)
    const submitQ = await req('POST', `/contests/${tempContest.id}/questions/${qId}/submit`, token, { selectedOptionId: correctOpt });
    log(submitQ.status === 200, `POST per-question submit (correct) → 200 (got ${submitQ.status})`);
    // Verify no isCorrect in response
    log(!('isCorrect' in (submitQ.data?.data || {})), 'Per-question response has NO isCorrect (no feedback)');

    // Re-submit same question → 409 (one attempt per question)
    const resubmit = await req('POST', `/contests/${tempContest.id}/questions/${qId}/submit`, token, { selectedOptionId: wrongOpt });
    log(resubmit.status === 409, `Re-submit same question rejected → 409 (got ${resubmit.status})`);

    // Final submit
    const final = await req('POST', `/contests/${tempContest.id}/submit`, token);
    log(final.status === 200, `POST final submit → 200 (got ${final.status})`);
    log(!!final.data?.data?.submittedAt, 'submittedAt set in response');

    // Try to start again → 409
    const restart = await req('POST', `/contests/${tempContest.id}/start`, token);
    log(restart.status === 409, `Re-start after final submit rejected → 409 (got ${restart.status})`);

    // Test stream mismatch: sara (Science-Biology) cannot start a Science-Maths contest
    const saraToken = await login('sara.ibrahim@student.com');
    const saraStart = await req('POST', `/contests/${tempContest.id}/start`, saraToken);
    log(saraStart.status === 403, `sara (Science-Biology) blocked from Science-Maths contest → 403 (got ${saraStart.status})`);

    // Test year filter: sara is 2nd-year → available list excludes all contests
    const saraAvail = await req('GET', '/contests/available', saraToken);
    log((saraAvail.data?.data || []).length === 0, 'sara (2nd-year) sees 0 available contests (year filter)');
  } finally {
    // Cleanup temp contest (cascade deletes questions/options/answers/participation)
    await p.contest.delete({ where: { id: tempContest.id } }).catch(() => {});
    console.log('  ℹ️  Cleaned up temp contest');
  }
}

// ── Run ──
const main = async () => {
  console.log('🧪 Contest Features — End-to-End Test\n==========================================');
  try {
    await testTeacherFlow();
    await testStudentFlow();
  } catch (e) {
    console.error('\n💥 Test script error:', e.message);
  } finally {
    await p.$disconnect();
  }
  console.log(`\n==========================================\n📊 Results: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};
main();
