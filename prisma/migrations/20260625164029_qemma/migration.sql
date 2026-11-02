/*
  Warnings:

  - You are about to drop the column `linked_student_id` on the `parents` table. All the data in the column will be lost.
  - You are about to drop the column `parent_id` on the `students` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "students" DROP CONSTRAINT "students_parent_id_fkey";

-- DropIndex
DROP INDEX "students_parent_id_idx";

-- AlterTable
ALTER TABLE "parents" DROP COLUMN "linked_student_id";

-- AlterTable
ALTER TABLE "students" DROP COLUMN "parent_id";

-- CreateTable
CREATE TABLE "parent_student" (
    "parent_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,

    CONSTRAINT "parent_student_pkey" PRIMARY KEY ("parent_id","student_id")
);

-- AddForeignKey
ALTER TABLE "parent_student" ADD CONSTRAINT "parent_student_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_student" ADD CONSTRAINT "parent_student_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
