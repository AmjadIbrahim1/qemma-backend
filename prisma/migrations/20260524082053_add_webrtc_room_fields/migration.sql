-- AlterTable
ALTER TABLE "webrtc_rooms" ADD COLUMN     "description" TEXT,
ADD COLUMN     "scheduled_at" TIMESTAMP(3),
ADD COLUMN     "title" TEXT;
