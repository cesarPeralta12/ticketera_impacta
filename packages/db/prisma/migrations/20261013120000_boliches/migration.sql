-- Boliches: mesas y lounges, consumo incluido (saldo en barra), entradas con horario de ingreso
-- y la categoría de evento. Aditiva: no borra ni renombra nada.

-- CreateEnum
CREATE TYPE "TicketKind" AS ENUM ('ENTRY', 'TABLE');

-- AlterEnum
ALTER TYPE "EventCategory" ADD VALUE 'BOLICHE';

-- AlterEnum
ALTER TYPE "ScanResult" ADD VALUE 'OUT_OF_HOURS';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "creditId" TEXT,
ADD COLUMN     "expiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TicketType" ADD COLUMN     "consumptionAmount" INTEGER,
ADD COLUMN     "entryUntil" TIMESTAMP(3),
ADD COLUMN     "kind" "TicketKind" NOT NULL DEFAULT 'ENTRY',
ADD COLUMN     "peoplePerUnit" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ConsumptionCredit" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "tableNumber" INTEGER,
    "amount" INTEGER NOT NULL,
    "spent" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumptionRedemption" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "staffId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsumptionCredit_sessionId_idx" ON "ConsumptionCredit"("sessionId");

-- CreateIndex
CREATE INDEX "ConsumptionCredit_orderId_idx" ON "ConsumptionCredit"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionCredit_ticketTypeId_tableNumber_key" ON "ConsumptionCredit"("ticketTypeId", "tableNumber");

-- CreateIndex
CREATE INDEX "ConsumptionRedemption_creditId_createdAt_idx" ON "ConsumptionRedemption"("creditId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_creditId_idx" ON "Ticket"("creditId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "ConsumptionCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionCredit" ADD CONSTRAINT "ConsumptionCredit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionCredit" ADD CONSTRAINT "ConsumptionCredit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionCredit" ADD CONSTRAINT "ConsumptionCredit_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionRedemption" ADD CONSTRAINT "ConsumptionRedemption_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "ConsumptionCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionRedemption" ADD CONSTRAINT "ConsumptionRedemption_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

