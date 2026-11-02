/*
  Warnings:

  - A unique constraint covering the columns `[phone]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "book_purchases" ADD COLUMN     "platform_commission" DOUBLE PRECISION,
ADD COLUMN     "teacher_earning" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "books" ADD COLUMN     "bookType" TEXT NOT NULL DEFAULT 'physical',
ADD COLUMN     "pdf_file_ref" TEXT;

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "platformFee" DOUBLE PRECISION,
ADD COLUMN     "teacherEarning" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "lesson_ratings" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "lesson_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_ratings" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "teacher_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_ratings" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "course_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_ratings" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "book_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_ratings_lesson_id_student_id_key" ON "lesson_ratings"("lesson_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_ratings_teacher_id_student_id_key" ON "teacher_ratings"("teacher_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_ratings_course_id_student_id_key" ON "course_ratings"("course_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "book_ratings_book_id_student_id_key" ON "book_ratings"("book_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- AddForeignKey
ALTER TABLE "lesson_ratings" ADD CONSTRAINT "lesson_ratings_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_ratings" ADD CONSTRAINT "lesson_ratings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_ratings" ADD CONSTRAINT "teacher_ratings_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_ratings" ADD CONSTRAINT "teacher_ratings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_ratings" ADD CONSTRAINT "course_ratings_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_ratings" ADD CONSTRAINT "course_ratings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_ratings" ADD CONSTRAINT "book_ratings_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_ratings" ADD CONSTRAINT "book_ratings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
