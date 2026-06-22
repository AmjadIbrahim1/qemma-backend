// backend/src/jobs/contestScoring.job.js
// ✅ NEW (planning_prompts/scoring-system.md): Contest scoring batch job.
// Runs every minute. Finds ended contests with unscored participations and runs:
//   Algorithm 1: Per-Contest Score (raw score + time penalty → final score + ranking)
//   Algorithm 2: Elo-Style Rating (seed → middle rank → target rating → delta with corrections)
// All scoring writes happen inside a single transaction per contest.

import cron from 'node-cron';
import prisma from '../config/prisma.config.js';

// ── Constants ───────────────────────────────────────────────────────────────────
const DIFFICULTY_MULTIPLIERS = { Easy: 1.0, Medium: 1.5, Hard: 2.0 };

// ── Helpers ─────────────────────────────────────────────────────────────────────

// Contest end time = startTime + duration minutes
function contestEndTime(contest) {
  return new Date(new Date(contest.startTime).getTime() + contest.duration * 60 * 1000);
}

// ── Algorithm 1: Per-Contest Score ──────────────────────────────────────────────

// Steps 1-3: compute raw score, time penalty, and final score for one participation.
function computePerContestScore(answers, pointValueMap, contestStart, contestDuration) {
  const correct = answers.filter(a => a.isCorrect);

  // Step 1: raw score = sum of pointValue for correctly answered questions
  const rawScore = correct.reduce(
    (sum, a) => sum + (pointValueMap[a.contestQuestionId] || 0), 0,
  );

  // Step 2: time penalty = sum of (submittedAt - startTime) in minutes for correct answers
  const totalTimePenaltyMinutes = correct.reduce((sum, a) => {
    const mins = (new Date(a.submittedAt) - new Date(contestStart)) / 60000;
    return sum + Math.max(0, mins);
  }, 0);
  const normalizedPenalty = contestDuration > 0
    ? Math.min(1, Math.max(0, totalTimePenaltyMinutes / contestDuration))
    : 0;

  // Step 3: final score = rawScore * (1 - 0.20 * normalizedPenalty)
  // ✅ NEW: clamp to minimum 0 (no negative scores)
  // const finalContestScore = rawScore * (1 - 0.20 * normalizedPenalty);
  const finalContestScore = Math.max(0, rawScore * (1 - 0.20 * normalizedPenalty));

  return { rawScore, totalTimePenaltyMinutes, finalContestScore };
}

// Step 4: assign ranks using standard competition ranking (ties share rank, next is skipped).
// Sort by finalContestScore desc, then totalTimePenaltyMinutes asc (tiebreaker).
function assignRanks(scored) {
  const sorted = [...scored].sort((a, b) => {
    if (b.finalContestScore !== a.finalContestScore)
      return b.finalContestScore - a.finalContestScore;
    return a.totalTimePenaltyMinutes - b.totalTimePenaltyMinutes;
  });

  let currentRank = 0;
  let prevScore = null;
  let prevPenalty = null;
  sorted.forEach((p, idx) => {
    const pos = idx + 1;
    if (prevScore !== null && p.finalContestScore === prevScore && p.totalTimePenaltyMinutes === prevPenalty) {
      // tie → same rank as previous
    } else {
      currentRank = pos;
    }
    p.actualRank = currentRank;
    prevScore = p.finalContestScore;
    prevPenalty = p.totalTimePenaltyMinutes;
  });

  return sorted; // sorted by rank (best first)
}

// ── Algorithm 2: Elo-Style Rating ───────────────────────────────────────────────

// Step 2: compute seed (expected rank) for a student.
function computeSeed(rating, otherRatings, isFirstContest, n) {
  if (isFirstContest) return 1 + n / 2;
  let sum = 0;
  for (const rj of otherRatings) {
    sum += 1 / (1 + Math.pow(10, (rating - rj) / 400));
  }
  return 1 + sum;
}

// Step 4 helper: compute seed from a candidate rating R (for binary search).
function seedFromRating(R, otherRatings) {
  let sum = 0;
  for (const rj of otherRatings) {
    sum += 1 / (1 + Math.pow(10, (R - rj) / 400));
  }
  return 1 + sum;
}

// Step 4: find target rating via binary search (seedFromRating is monotonically DECREASING in R:
// higher R → lower expected rank → lower seed).
function findTargetRating(middleRank, otherRatings) {
  if (otherRatings.length === 0) return null; // no others → can't determine
  let lo = -2000, hi = 4000;
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    const seed = seedFromRating(mid, otherRatings);
    // ✅ FIXED: seedFromRating is DECREASING in R, so if seed > middleRank we need higher R (move lo up)
    // if (seed < middleRank) lo = mid;  // OLD: wrong direction
    // else hi = mid;
    if (seed > middleRank) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Full Algorithm 2: compute rating deltas for all participants.
// Returns array of { studentId, ratingDelta } (ratingDelta is rounded integer).
function computeRatings(ranked, difficulty, preRatings, isFirstMap) {
  const n = ranked.length;
  if (n === 0) return [];

  // Single participant → no rating change (no one to compare against)
  if (n === 1) {
    return [{ studentId: ranked[0].studentId, ratingDelta: 0 }];
  }

  const multiplier = DIFFICULTY_MULTIPLIERS[difficulty] || 1.0;
  const allRatings = ranked.map(p => preRatings[p.studentId]);

  // Steps 2-6: compute scaled delta for each participant
  const deltas = ranked.map((p, i) => {
    const r = preRatings[p.studentId];
    const isFirst = isFirstMap[p.studentId] || false;
    const otherRatings = allRatings.filter((_, j) => j !== i);

    // Step 2: seed
    const seed = computeSeed(r, otherRatings, isFirst, n);

    // Step 3: middle rank (geometric mean)
    const middleRank = Math.sqrt(seed * p.actualRank);

    // Step 4: target rating (binary search)
    const targetRating = findTargetRating(middleRank, otherRatings);
    if (targetRating === null) {
      return { studentId: p.studentId, scaledDelta: 0, isFirst };
    }

    // Step 5: raw delta
    const rawDelta = (targetRating - r) / 2;

    // Step 6: difficulty multiplier
    const scaledDelta = rawDelta * multiplier;

    return { studentId: p.studentId, scaledDelta, isFirst };
  });

  // Step 7: anti-inflation corrections
  // First correction — zero-sum adjustment
  const sumDeltas = deltas.reduce((s, d) => s + d.scaledDelta, 0);
  const adjustment = sumDeltas / (n - 1);
  deltas.forEach(d => { d.scaledDelta -= adjustment; });

  // Second correction — top group cap
  const topGroupSize = Math.max(1, Math.floor(Math.sqrt(n)));
  const indexedByPreRating = ranked
    .map((p, i) => ({ i, preRating: preRatings[p.studentId] }))
    .sort((a, b) => b.preRating - a.preRating);
  const topGroup = indexedByPreRating.slice(0, topGroupSize);
  const topGroupSum = topGroup.reduce((s, t) => s + deltas[t.i].scaledDelta, 0);
  if (topGroupSum > 0) {
    const extraAdjustment = Math.min(topGroupSum / topGroupSize, 10);
    deltas.forEach(d => { d.scaledDelta -= extraAdjustment; });
  }

  // Step 8: first-time participant guarantee (no rating loss on first contest)
  deltas.forEach(d => {
    if (d.isFirst && d.scaledDelta < 0) d.scaledDelta = 0;
  });

  // Step 9: consistency rules (applied top-down from leaderboard)
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      const preI = preRatings[ranked[i].studentId];
      const preJ = preRatings[ranked[j].studentId];

      // Rule 1: j (worse rank) had lower pre-rating but ended up with higher new rating → clamp j down
      const newI = preI + deltas[i].scaledDelta;
      const newJ = preJ + deltas[j].scaledDelta;
      if (preJ < preI && newJ > newI) {
        deltas[j].scaledDelta = newI - preJ;
      }

      // Rule 2: i (better rank) had lower pre-rating but smaller delta → raise i's delta to j's
      if (preI < preJ && deltas[i].scaledDelta < deltas[j].scaledDelta) {
        deltas[i].scaledDelta = deltas[j].scaledDelta;
      }
    }
  }

  // Step 10: round to nearest integer
  return deltas.map(d => ({
    studentId: d.studentId,
    ratingDelta: Math.round(d.scaledDelta),
  }));
}

// ── Score one contest (Algorithm 1 + Algorithm 2 + DB writes) ──────────────────

async function scoreContest(contest) {
  // Fetch all participations with answers + student's current rating
  const participations = await prisma.contestParticipation.findMany({
    where:   { contestId: contest.id },
    include: {
      answers: { select: { isCorrect: true, submittedAt: true, contestQuestionId: true } },
      student: { select: { id: true, rating: true } },
    },
  });

  if (participations.length === 0) return { scored: 0 };

  // Fetch question point values
  const questions = await prisma.contestQuestion.findMany({
    where:   { contestId: contest.id },
    select:  { id: true, pointValue: true },
  });
  const pointValueMap = {};
  questions.forEach(q => { pointValueMap[q.id] = q.pointValue; });

  // Determine first-time participants (no prior participations with ratingAfter set)
  const studentIds = participations.map(p => p.studentId);
  const prior = await prisma.contestParticipation.findMany({
    where:  { studentId: { in: studentIds }, contestId: { not: contest.id }, ratingAfter: { not: null } },
    select: { studentId: true },
  });
  const studentsWithPrior = new Set(prior.map(p => p.studentId));

  // Algorithm 1: compute per-contest scores
  const contestStart = new Date(contest.startTime);
  const scored = participations.map(p => ({
    id:       p.id,
    studentId: p.studentId,
    ...computePerContestScore(p.answers, pointValueMap, contestStart, contest.duration),
    actualRank: null,
  }));

  // Algorithm 1 Step 4: assign ranks
  const ranked = assignRanks(scored);

  // Pre-compute maps for Algorithm 2
  const preRatings = {};
  participations.forEach(p => { preRatings[p.studentId] = p.student.rating; });
  const isFirstMap = {};
  studentIds.forEach(sid => { isFirstMap[sid] = !studentsWithPrior.has(sid); });

  // Algorithm 2: compute rating deltas
  const ratingResults = computeRatings(ranked, contest.difficulty, preRatings, isFirstMap);
  const deltaMap = {};
  ratingResults.forEach(r => { deltaMap[r.studentId] = r.ratingDelta; });

  // Write all results in a single transaction
  await prisma.$transaction(async (tx) => {
    for (const p of ranked) {
      const ratingBefore = preRatings[p.studentId];
      // ✅ NEW: clamp ratingAfter to minimum 0 (no negative ratings)
      // const ratingDelta  = deltaMap[p.studentId];
      // const ratingAfter  = ratingBefore + ratingDelta;
      const rawDelta     = deltaMap[p.studentId];
      const ratingAfter  = Math.max(0, ratingBefore + rawDelta);
      const ratingDelta  = ratingAfter - ratingBefore; // reflects the clamped change
      const isFirst      = isFirstMap[p.studentId];

      await tx.contestParticipation.update({
        where: { id: p.id },
        data:  {
          rawScore:                p.rawScore,
          totalTimePenaltyMinutes: p.totalTimePenaltyMinutes,
          finalContestScore:       p.finalContestScore,
          actualRank:              p.actualRank,
          isFirstContest:          isFirst,
          ratingBefore,
          ratingDelta,
          ratingAfter,
        },
      });

      // Update student's global rating
      await tx.student.update({
        where: { id: p.studentId },
        data:  { rating: ratingAfter },
      });
    }
  });

  return { scored: ranked.length };
}

// ── Cron entry point ────────────────────────────────────────────────────────────

async function run() {
  try {
    const now = new Date();

    // Find non-test contests that have at least one unscored participation
    const contests = await prisma.contest.findMany({
      where: {
        isTest: false,
        participations: { some: { finalContestScore: null } },
      },
    });

    // Filter to ended contests (now > endTime) — can't do this in Prisma where (per-row arithmetic)
    const endedContests = contests.filter(c => now > contestEndTime(c));

    for (const contest of endedContests) {
      try {
        const result = await scoreContest(contest);
        if (result.scored > 0) {
          console.log(`📊 contestScoring: scored "${contest.title}" — ${result.scored} participations`);
        }
      } catch (err) {
        console.error(`❌ contestScoring: failed to score "${contest.title}":`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ contestScoring error:', err.message);
  }
}

// ── Register ────────────────────────────────────────────────────────────────────
cron.schedule('* * * * *', run);
console.log('⏰ contestScoring cron registered (every minute)');
