-- CreateTable
CREATE TABLE "books" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "teacher_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "subject" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cover_image" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_purchases" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "book_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "books_teacher_id_idx" ON "books"("teacher_id");

-- CreateIndex
CREATE INDEX "books_subject_idx" ON "books"("subject");

-- CreateIndex
CREATE INDEX "books_grade_idx" ON "books"("grade");

-- CreateIndex
CREATE INDEX "book_purchases_book_id_idx" ON "book_purchases"("book_id");

-- CreateIndex
CREATE INDEX "book_purchases_student_id_idx" ON "book_purchases"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "book_purchases_book_id_student_id_key" ON "book_purchases"("book_id", "student_id");

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_purchases" ADD CONSTRAINT "book_purchases_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_purchases" ADD CONSTRAINT "book_purchases_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
