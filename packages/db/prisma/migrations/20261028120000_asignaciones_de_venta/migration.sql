-- Qué puede vender cada cajero y promotor (eventos y funciones), métodos de cobro por cuenta, cupo y teléfono del
-- promotor, liquidación de comisiones, anulaciones con motivo y aforo de zona que bloquea. Todo se agrega: los cajeros
-- que ya existen siguen vendiendo todo (salesScope ALL) y no cambia ninguna venta.
-- CreateEnum
CREATE TYPE "SalesScope" AS ENUM ('ALL', 'ASSIGNED');

-- AlterEnum
ALTER TYPE "ScanResult" ADD VALUE 'ZONE_FULL';

-- AlterTable
ALTER TABLE "AccessZone" ADD COLUMN     "blockWhenFull" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "posMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "salesScope" "SalesScope" NOT NULL DEFAULT 'ALL';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "commissionPayoutId" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- AlterTable
ALTER TABLE "PromoterAssignment" ADD COLUMN     "quota" INTEGER;

-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "SalesAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionPayout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "promoterId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "orders" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesAssignment_userId_idx" ON "SalesAssignment"("userId");

-- CreateIndex
CREATE INDEX "SalesAssignment_eventId_idx" ON "SalesAssignment"("eventId");

-- CreateIndex
CREATE INDEX "SalesAssignment_sessionId_idx" ON "SalesAssignment"("sessionId");

-- CreateIndex
CREATE INDEX "CommissionPayout_organizationId_promoterId_idx" ON "CommissionPayout"("organizationId", "promoterId");

-- AddForeignKey
ALTER TABLE "SalesAssignment" ADD CONSTRAINT "SalesAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAssignment" ADD CONSTRAINT "SalesAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAssignment" ADD CONSTRAINT "SalesAssignment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPayout" ADD CONSTRAINT "CommissionPayout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPayout" ADD CONSTRAINT "CommissionPayout_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPayout" ADD CONSTRAINT "CommissionPayout_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_commissionPayoutId_fkey" FOREIGN KEY ("commissionPayoutId") REFERENCES "CommissionPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Los promotores que ya tenían eventos asignados los siguen vendiendo completos (todas sus funciones).
INSERT INTO "SalesAssignment" ("id", "userId", "eventId", "sessionId", "active", "createdAt", "updatedAt")
SELECT 'sa' || md5(pa."id" || clock_timestamp()::text), pa."userId", pa."eventId", NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "PromoterAssignment" pa;
