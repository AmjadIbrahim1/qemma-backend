-- AlterTable: AI contest question generation idempotency/observability markers
ALTER TABLE "contests" ADD COLUMN "ai_generation_status" TEXT;
ALTER TABLE "contests" ADD COLUMN "ai_generated_at" TIMESTAMP(3);

-- AlterTable: mark AI-generated vs teacher-authored contest questions
ALTER TABLE "contest_questions" ADD COLUMN "ai_generated" BOOLEAN NOT NULL DEFAULT false;
