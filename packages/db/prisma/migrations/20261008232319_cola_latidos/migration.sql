-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "QueueEntry_sessionId_customerId_idx" ON "QueueEntry"("sessionId", "customerId");
