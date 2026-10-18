-- Entradas impresas: lotes numerados, estados (en stock, entregada, vendida, devuelta, anulada), rendiciones y arte propio.

-- CreateEnum
CREATE TYPE "PrintMode" AS ENUM ('VALID_ON_PRINT', 'ACTIVATE_ON_SALE');

-- CreateEnum
CREATE TYPE "PrintState" AS ENUM ('STOCK', 'ASSIGNED', 'SOLD', 'RETURNED', 'VOID');

-- AlterEnum
ALTER TYPE "OrderChannel" ADD VALUE 'PRINTED';

-- AlterEnum
ALTER TYPE "ScanResult" ADD VALUE 'NOT_ACTIVATED';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedTo" TEXT,
ADD COLUMN     "printBatchId" TEXT,
ADD COLUMN     "printState" "PrintState",
ADD COLUMN     "printedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serial" TEXT,
ADD COLUMN     "soldAt" TIMESTAMP(3),
ADD COLUMN     "soldById" TEXT,
ADD COLUMN     "soldMethod" TEXT;

-- CreateTable
CREATE TABLE "PrintBatch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "firstNumber" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "mode" "PrintMode" NOT NULL DEFAULT 'ACTIVATE_ON_SALE',
    "unitAmount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "note" TEXT,
    "artId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintSettlement" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "sold" INTEGER NOT NULL,
    "returned" INTEGER NOT NULL,
    "expectedAmount" INTEGER NOT NULL,
    "receivedAmount" INTEGER NOT NULL,
    "note" TEXT,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketArt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketArt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrintBatch_sessionId_idx" ON "PrintBatch"("sessionId");

-- CreateIndex
CREATE INDEX "PrintSettlement_batchId_idx" ON "PrintSettlement"("batchId");

-- CreateIndex
CREATE INDEX "TicketArt_organizationId_idx" ON "TicketArt"("organizationId");

-- CreateIndex
CREATE INDEX "Ticket_printBatchId_idx" ON "Ticket"("printBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_sessionId_serial_key" ON "Ticket"("sessionId", "serial");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_printBatchId_fkey" FOREIGN KEY ("printBatchId") REFERENCES "PrintBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_artId_fkey" FOREIGN KEY ("artId") REFERENCES "TicketArt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintSettlement" ADD CONSTRAINT "PrintSettlement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PrintBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintSettlement" ADD CONSTRAINT "PrintSettlement_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketArt" ADD CONSTRAINT "TicketArt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

