-- CreateEnum
CREATE TYPE "StudentYear" AS ENUM ('first', 'second', 'third');

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "rating" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "year" "StudentYear";

-- AlterTable
ALTER TABLE "teachers" ADD COLUMN     "stream" TEXT;

-- CreateTable
CREATE TABLE "contests" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "question_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_questions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "point_value" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_options" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "contest_question_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contest_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_participations" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "final_contest_score" DOUBLE PRECISION NOT NULL,
    "raw_score" DOUBLE PRECISION NOT NULL,
    "total_time_penalty_minutes" DOUBLE PRECISION NOT NULL,
    "actual_rank" INTEGER NOT NULL,
    "rating_before" INTEGER NOT NULL,
    "rating_delta" INTEGER NOT NULL,
    "rating_after" INTEGER NOT NULL,
    "is_first_contest" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_answers" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "participation_id" TEXT NOT NULL,
    "contest_question_id" TEXT NOT NULL,
    "selected_option_id" TEXT,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contest_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contests_stream_idx" ON "contests"("stream");

-- CreateIndex
CREATE INDEX "contests_start_time_idx" ON "contests"("start_time");

-- CreateIndex
CREATE INDEX "contest_questions_contest_id_idx" ON "contest_questions"("contest_id");

-- CreateIndex
CREATE INDEX "contest_options_contest_question_id_idx" ON "contest_options"("contest_question_id");

-- CreateIndex
CREATE INDEX "contest_participations_contest_id_idx" ON "contest_participations"("contest_id");

-- CreateIndex
CREATE INDEX "contest_participations_student_id_idx" ON "contest_participations"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_participations_contest_id_student_id_key" ON "contest_participations"("contest_id", "student_id");

-- CreateIndex
CREATE INDEX "contest_answers_participation_id_idx" ON "contest_answers"("participation_id");

-- CreateIndex
CREATE INDEX "contest_answers_contest_question_id_idx" ON "contest_answers"("contest_question_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_answers_participation_id_contest_question_id_key" ON "contest_answers"("participation_id", "contest_question_id");

-- CreateIndex
CREATE INDEX "students_year_stream_idx" ON "students"("year", "stream");

-- CreateIndex
CREATE INDEX "teachers_stream_idx" ON "teachers"("stream");

-- AddForeignKey
ALTER TABLE "contest_questions" ADD CONSTRAINT "contest_questions_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_options" ADD CONSTRAINT "contest_options_contest_question_id_fkey" FOREIGN KEY ("contest_question_id") REFERENCES "contest_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participations" ADD CONSTRAINT "contest_participations_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participations" ADD CONSTRAINT "contest_participations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_answers" ADD CONSTRAINT "contest_answers_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "contest_participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_answers" ADD CONSTRAINT "contest_answers_contest_question_id_fkey" FOREIGN KEY ("contest_question_id") REFERENCES "contest_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ✅ NEW: Data migration — convert existing Student.stream values to canonical names
-- (handles both old validator values science-math/science-bio/arts AND seed Arabic labels,
--  so the contest join Student.stream = Contest.stream works regardless of prior source)
UPDATE "students" SET "stream" = 'Science-Maths'   WHERE "stream" IN ('science-math', 'علمي رياضة');
UPDATE "students" SET "stream" = 'Science-Biology' WHERE "stream" IN ('science-bio',  'علمي علوم');
UPDATE "students" SET "stream" = 'Literary'        WHERE "stream" IN ('arts',         'أدبي');
