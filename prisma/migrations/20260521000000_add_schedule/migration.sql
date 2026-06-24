-- backend/prisma/migrations/20260521000000_add_schedule/migration.sql

CREATE TABLE "schedules" (
    "id"           TEXT NOT NULL DEFAULT gen_random_uuid(),
    "teacher_id"   TEXT NOT NULL,
    "course_id"    TEXT,
    "title"        TEXT NOT NULL,
    "description"  TEXT,
    "date"         DATE NOT NULL,
    "start_time"   TEXT NOT NULL,
    "end_time"     TEXT NOT NULL,
    "type"         TEXT NOT NULL DEFAULT 'online',
    "meeting_link" TEXT,
    "max_students" INTEGER,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedules_teacher_id_idx" ON "schedules"("teacher_id");
CREATE INDEX "schedules_course_id_idx"  ON "schedules"("course_id");
CREATE INDEX "schedules_date_idx"       ON "schedules"("date");

ALTER TABLE "schedules"
    ADD CONSTRAINT "schedules_teacher_id_fkey"
    FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schedules"
    ADD CONSTRAINT "schedules_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;