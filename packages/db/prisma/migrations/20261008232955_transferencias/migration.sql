-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "transfersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "holderDocument" TEXT,
ADD COLUMN     "transferCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transferredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TicketTransfer" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromCustomerId" TEXT NOT NULL,
    "toCustomerId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "oldCode" TEXT,
    "newCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TicketTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketTransfer_ticketId_status_idx" ON "TicketTransfer"("ticketId", "status");

-- CreateIndex
CREATE INDEX "TicketTransfer_toCustomerId_status_idx" ON "TicketTransfer"("toCustomerId", "status");

-- CreateIndex
CREATE INDEX "TicketTransfer_fromCustomerId_status_createdAt_idx" ON "TicketTransfer"("fromCustomerId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_fromCustomerId_fkey" FOREIGN KEY ("fromCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_toCustomerId_fkey" FOREIGN KEY ("toCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
