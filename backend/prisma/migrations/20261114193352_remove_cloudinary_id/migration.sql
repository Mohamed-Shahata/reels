/*
  Warnings:

  - You are about to drop the column `cloudinaryId` on the `Video` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "VideoLayout" AS ENUM ('AUTO', 'STACKED');

-- DropIndex
DROP INDEX "Video_cloudinaryId_key";

-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "layout" "VideoLayout" NOT NULL DEFAULT 'AUTO';

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "cloudinaryId",
ADD COLUMN     "failedStage" "JobType";

-- CreateIndex
CREATE INDEX "ProcessingJob_userId_status_idx" ON "ProcessingJob"("userId", "status");

-- CreateIndex
CREATE INDEX "ProcessingJob_status_createdAt_idx" ON "ProcessingJob"("status", "createdAt");
