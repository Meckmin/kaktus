-- Meeting invites (coach proposes a time, student accepts), the weekly study
-- plan (StudyTask, per coach–student pair), and the Daily room per booking.
-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExamPart" AS ENUM ('TYT', 'AYT', 'YDT');

-- CreateEnum
CREATE TYPE "StudyTaskKind" AS ENUM ('KONU_ANLATIMI', 'SORU_BANKASI', 'BRANS_DENEMESI', 'GENEL_DENEME', 'TEKRAR', 'DIGER');

-- CreateEnum
CREATE TYPE "StudyTaskUnit" AS ENUM ('SORU', 'TEST', 'DAKIKA', 'SAYFA', 'VIDEO');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "videoRoomName" TEXT;

-- CreateTable
CREATE TABLE "MeetingInvite" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "bookingId" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "message" TEXT,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyTask" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "examPart" "ExamPart",
    "subject" TEXT,
    "topic" TEXT,
    "kind" "StudyTaskKind" NOT NULL,
    "resource" TEXT,
    "description" TEXT,
    "quantity" INTEGER,
    "unit" "StudyTaskUnit",
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingInvite_engagementId_status_idx" ON "MeetingInvite"("engagementId", "status");

-- CreateIndex
CREATE INDEX "MeetingInvite_bookingId_idx" ON "MeetingInvite"("bookingId");

-- CreateIndex
CREATE INDEX "StudyTask_conversationId_day_idx" ON "StudyTask"("conversationId", "day");

-- AddForeignKey
ALTER TABLE "MeetingInvite" ADD CONSTRAINT "MeetingInvite_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingInvite" ADD CONSTRAINT "MeetingInvite_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

