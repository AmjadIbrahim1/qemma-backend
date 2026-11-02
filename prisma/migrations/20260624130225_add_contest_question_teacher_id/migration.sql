-- AlterTable
ALTER TABLE "contest_questions" ADD COLUMN     "teacher_id" TEXT;

-- CreateIndex
CREATE INDEX "contest_questions_teacher_id_idx" ON "contest_questions"("teacher_id");

-- AddForeignKey
ALTER TABLE "contest_questions" ADD CONSTRAINT "contest_questions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
