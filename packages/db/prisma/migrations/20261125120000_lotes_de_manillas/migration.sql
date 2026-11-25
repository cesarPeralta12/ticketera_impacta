-- CreateEnum
CREATE TYPE "WristbandBatchStatus" AS ENUM ('OPEN', 'CONFIRMED', 'DISCARDED');

-- CreateTable
CREATE TABLE "WristbandBatch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "PrintMode" NOT NULL DEFAULT 'VALID_ON_PRINT',
    "prefix" TEXT,
    "expected" INTEGER,
    "status" "WristbandBatchStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "printBatchId" TEXT,

    CONSTRAINT "WristbandBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WristbandItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "card" JSONB,
    "position" INTEGER NOT NULL,
    "readById" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WristbandItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WristbandBatch_printBatchId_key" ON "WristbandBatch"("printBatchId");

-- CreateIndex
CREATE INDEX "WristbandBatch_sessionId_idx" ON "WristbandBatch"("sessionId");

-- CreateIndex
CREATE INDEX "WristbandItem_uid_idx" ON "WristbandItem"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "WristbandItem_batchId_uid_key" ON "WristbandItem"("batchId", "uid");

-- CreateIndex
CREATE UNIQUE INDEX "WristbandItem_batchId_position_key" ON "WristbandItem"("batchId", "position");

-- AddForeignKey
ALTER TABLE "WristbandBatch" ADD CONSTRAINT "WristbandBatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WristbandBatch" ADD CONSTRAINT "WristbandBatch_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WristbandBatch" ADD CONSTRAINT "WristbandBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WristbandBatch" ADD CONSTRAINT "WristbandBatch_printBatchId_fkey" FOREIGN KEY ("printBatchId") REFERENCES "PrintBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WristbandItem" ADD CONSTRAINT "WristbandItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WristbandBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

