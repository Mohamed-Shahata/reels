ALTER TABLE "UsageRecord"
ADD COLUMN "aiRunCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SegmentationRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "clipCount" INTEGER NOT NULL,
    "replacedClipCount" INTEGER NOT NULL DEFAULT 0,
    "segments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SegmentationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SegmentationRun_videoId_createdAt_idx" ON "SegmentationRun"("videoId", "createdAt");
CREATE INDEX "SegmentationRun_userId_createdAt_idx" ON "SegmentationRun"("userId", "createdAt");

ALTER TABLE "SegmentationRun" ADD CONSTRAINT "SegmentationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SegmentationRun" ADD CONSTRAINT "SegmentationRun_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
