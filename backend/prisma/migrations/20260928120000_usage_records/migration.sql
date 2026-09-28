CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthStart" TIMESTAMP(3) NOT NULL,
    "uploadedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clipCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageRecord_userId_monthStart_key" ON "UsageRecord"("userId", "monthStart");
CREATE INDEX "UsageRecord_userId_monthStart_idx" ON "UsageRecord"("userId", "monthStart");

ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
