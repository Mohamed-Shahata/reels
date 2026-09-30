ALTER TYPE "ProcessingJobType" ADD VALUE 'RENDER';

CREATE TABLE "ClipRender" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "processingJobId" TEXT,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "outputUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipRender_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClipRender_processingJobId_key" ON "ClipRender"("processingJobId");
CREATE INDEX "ClipRender_clipId_createdAt_idx" ON "ClipRender"("clipId", "createdAt");

ALTER TABLE "ClipRender" ADD CONSTRAINT "ClipRender_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClipRender" ADD CONSTRAINT "ClipRender_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
