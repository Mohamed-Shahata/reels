-- AlterEnum VideoStatus
ALTER TYPE "VideoStatus" ADD VALUE IF NOT EXISTS 'UPLOADED';
ALTER TYPE "VideoStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "VideoStatus" ADD VALUE IF NOT EXISTS 'DELETING';

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('PODCAST', 'SOLO');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('DRAFT', 'READY');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('SOURCE', 'AUDIO', 'PROXY', 'POSTER', 'THUMB', 'RENDER', 'SUBTITLE_FILE');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING', 'READY', 'DELETING', 'DELETED');

-- CreateEnum JobType
CREATE TYPE "JobType" AS ENUM ('INGEST', 'TRANSCRIBE', 'SEGMENT', 'ANALYZE', 'RENDER', 'CLEANUP');

-- CreateEnum JobStatus
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRYING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable Video
ALTER TABLE "Video" ADD COLUMN "contentType" "ContentType" NOT NULL DEFAULT 'SOLO';
ALTER TABLE "Video" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable Clip
ALTER TABLE "Clip" ADD COLUMN "status" "ClipStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Clip" ADD COLUMN "score" DOUBLE PRECISION;
ALTER TABLE "Clip" ADD COLUMN "reason" TEXT;

-- AlterTable TranscriptSegment
ALTER TABLE "TranscriptSegment" ADD COLUMN "speaker" TEXT;

-- AlterTable ClipRender
ALTER TABLE "ClipRender" ADD COLUMN "assetId" TEXT;

-- AlterTable ProcessingJob - migrate type and status, add new columns
ALTER TABLE "ProcessingJob" ADD COLUMN "new_type" "JobType";
UPDATE "ProcessingJob" SET "new_type" = CASE
  WHEN "type"::text = 'TRANSCRIPTION' THEN 'TRANSCRIBE'::"JobType"
  WHEN "type"::text = 'RENDER' THEN 'RENDER'::"JobType"
  ELSE 'TRANSCRIBE'::"JobType"
END;
ALTER TABLE "ProcessingJob" DROP COLUMN "type";
ALTER TABLE "ProcessingJob" RENAME COLUMN "new_type" TO "type";
ALTER TABLE "ProcessingJob" ALTER COLUMN "type" SET NOT NULL;

ALTER TABLE "ProcessingJob" ADD COLUMN "new_status" "JobStatus" DEFAULT 'QUEUED';
UPDATE "ProcessingJob" SET "new_status" = CASE
  WHEN "status"::text = 'PENDING' THEN 'QUEUED'::"JobStatus"
  WHEN "status"::text = 'RUNNING' THEN 'RUNNING'::"JobStatus"
  WHEN "status"::text = 'COMPLETED' THEN 'COMPLETED'::"JobStatus"
  WHEN "status"::text = 'FAILED' AND "lastError" = 'Stopped by the user' THEN 'CANCELLED'::"JobStatus"
  WHEN "status"::text = 'FAILED' THEN 'FAILED'::"JobStatus"
  ELSE 'QUEUED'::"JobStatus"
END;
ALTER TABLE "ProcessingJob" DROP COLUMN "status";
ALTER TABLE "ProcessingJob" RENAME COLUMN "new_status" TO "status";
ALTER TABLE "ProcessingJob" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "ProcessingJob" ALTER COLUMN "status" SET DEFAULT 'QUEUED';

-- Drop old enums
DROP TYPE IF EXISTS "ProcessingJobType";
DROP TYPE IF EXISTS "ProcessingJobStatus";

-- Add new columns to ProcessingJob
ALTER TABLE "ProcessingJob" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "ProcessingJob" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProcessingJob" ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "ProcessingJob" ADD COLUMN "lockedBy" TEXT;
ALTER TABLE "ProcessingJob" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
ALTER TABLE "ProcessingJob" ADD COLUMN "errorCode" TEXT;

-- Copy attempts to attempt if it was populated
UPDATE "ProcessingJob" SET "attempt" = "attempts" WHERE "attempts" IS NOT NULL;
ALTER TABLE "ProcessingJob" DROP COLUMN IF EXISTS "attempts";

-- Unique Index on idempotencyKey
CREATE UNIQUE INDEX "ProcessingJob_idempotencyKey_key" ON "ProcessingJob"("idempotencyKey");

-- CreateTable JobEvent
CREATE TABLE "JobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "data" JSONB,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable OutboxEvent
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "routingKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable MediaAsset
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT,
    "clipId" TEXT,
    "kind" "AssetKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "contentType" TEXT,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable ReframePlan
CREATE TABLE "ReframePlan" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentType" "ContentType" NOT NULL DEFAULT 'SOLO',
    "faces" JSONB NOT NULL,
    "speakerTurns" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReframePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobEvent_jobId_at_idx" ON "JobEvent"("jobId", "at");
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
CREATE INDEX "MediaAsset_userId_idx" ON "MediaAsset"("userId");
CREATE INDEX "MediaAsset_videoId_idx" ON "MediaAsset"("videoId");
CREATE INDEX "MediaAsset_clipId_idx" ON "MediaAsset"("clipId");
CREATE INDEX "MediaAsset_status_expiresAt_idx" ON "MediaAsset"("status", "expiresAt");
CREATE UNIQUE INDEX "ReframePlan_videoId_key" ON "ReframePlan"("videoId");

-- AddForeignKey
ALTER TABLE "ClipRender" ADD CONSTRAINT "ClipRender_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReframePlan" ADD CONSTRAINT "ReframePlan_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
