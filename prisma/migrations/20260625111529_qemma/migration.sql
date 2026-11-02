-- AlterTable
ALTER TABLE "parents" ADD COLUMN     "is_activated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linked_student_id" TEXT;
