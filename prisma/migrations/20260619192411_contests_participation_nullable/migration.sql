-- AlterTable
ALTER TABLE "contest_participations" ADD COLUMN     "submitted_at" TIMESTAMP(3),
ALTER COLUMN "final_contest_score" DROP NOT NULL,
ALTER COLUMN "raw_score" DROP NOT NULL,
ALTER COLUMN "total_time_penalty_minutes" DROP NOT NULL,
ALTER COLUMN "actual_rank" DROP NOT NULL,
ALTER COLUMN "rating_before" DROP NOT NULL,
ALTER COLUMN "rating_delta" DROP NOT NULL,
ALTER COLUMN "rating_after" DROP NOT NULL;
