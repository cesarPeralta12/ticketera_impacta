-- Promotores: cuentas que venden con cobro por QR los eventos asignados, con su comisión por evento.
-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENT', 'FIXED');

-- AlterEnum
ALTER TYPE "OrderChannel" ADD VALUE 'PROMOTER';

-- AlterEnum
ALTER TYPE "StaffRole" ADD VALUE 'PROMOTER';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "buyerPhone" TEXT,
ADD COLUMN     "commissionAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promoterId" TEXT;

-- AlterTable
ALTER TABLE "PromoCode" ADD COLUMN     "promoterId" TEXT;

-- CreateTable
CREATE TABLE "PromoterAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "commissionType" "CommissionType" NOT NULL,
    "commissionValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromoterAssignment_eventId_idx" ON "PromoterAssignment"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoterAssignment_userId_eventId_key" ON "PromoterAssignment"("userId", "eventId");

-- CreateIndex
CREATE INDEX "Order_promoterId_idx" ON "Order"("promoterId");

-- AddForeignKey
ALTER TABLE "PromoterAssignment" ADD CONSTRAINT "PromoterAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoterAssignment" ADD CONSTRAINT "PromoterAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

