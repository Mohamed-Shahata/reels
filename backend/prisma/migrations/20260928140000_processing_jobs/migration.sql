CREATE TYPE "ProcessingJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TYPE "ProcessingJobType" AS ENUM ('TRANSCRIPTION');

CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT,
    "type" "ProcessingJobType" NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'PENDING',
    "bullJobId" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "payload" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessingJob_bullJobId_key" ON "ProcessingJob"("bullJobId");
CREATE INDEX "ProcessingJob_userId_status_idx" ON "ProcessingJob"("userId", "status");
CREATE INDEX "ProcessingJob_videoId_idx" ON "ProcessingJob"("videoId");
CREATE INDEX "ProcessingJob_status_createdAt_idx" ON "ProcessingJob"("status", "createdAt");

ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
