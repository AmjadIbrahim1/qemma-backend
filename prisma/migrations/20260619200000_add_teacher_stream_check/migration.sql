-- ✅ NEW: DB-level enforcement of Teacher.stream allowed values (5).
-- Prisma doesn't model CHECK constraints, so this is hand-written SQL applied via `prisma migrate deploy`.
-- Allowed: Literary, Science-Maths, Science-Biology (shared with Student.stream/Contest.stream for the
-- notification join) + general, science (teacher-only). NULL allowed (stream is optional / derived).
-- Mirrors auth.validator.js `body('stream')` allowed set + subject-stream.map.js TEACHER_STREAMS.
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_stream_check"
  CHECK ("stream" IS NULL OR "stream" IN ('Literary', 'Science-Maths', 'Science-Biology', 'general', 'science'));
