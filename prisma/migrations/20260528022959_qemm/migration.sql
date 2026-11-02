-- AlterTable
ALTER TABLE "students" ADD COLUMN     "parent_id" TEXT;

-- CreateIndex
CREATE INDEX "students_parent_id_idx" ON "students"("parent_id");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
