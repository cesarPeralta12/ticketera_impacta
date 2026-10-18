
-- CreateEnum
CREATE TYPE "GateDirection" AS ENUM ('IN', 'OUT', 'BOTH');

-- CreateEnum
CREATE TYPE "PresenceMovement" AS ENUM ('ENTRY', 'REENTRY', 'EXIT', 'ZONE_CHANGE', 'MANUAL');

-- AlterEnum
ALTER TYPE "ScanResult" ADD VALUE 'NOT_INSIDE';

-- AlterTable
ALTER TABLE "AccessPoint" ADD COLUMN     "direction" "GateDirection" NOT NULL DEFAULT 'IN',
ADD COLUMN     "zoneId" TEXT;

-- AlterTable
ALTER TABLE "AccessScan" ADD COLUMN     "movement" "PresenceMovement",
ADD COLUMN     "zoneId" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "entries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "inside" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastMovementAt" TIMESTAMP(3),
ADD COLUMN     "zoneId" TEXT;

-- AlterTable
ALTER TABLE "TicketType" ADD COLUMN     "maxEntries" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "AccessZone" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "capacity" INTEGER,
    "color" TEXT NOT NULL DEFAULT '#2E9E6A',

    CONSTRAINT "AccessZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TicketTypeZones" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TicketTypeZones_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessZone_venueId_name_key" ON "AccessZone"("venueId", "name");

-- CreateIndex
CREATE INDEX "_TicketTypeZones_B_index" ON "_TicketTypeZones"("B");

-- CreateIndex
CREATE INDEX "Ticket_sessionId_inside_zoneId_idx" ON "Ticket"("sessionId", "inside", "zoneId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "AccessZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessPoint" ADD CONSTRAINT "AccessPoint_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "AccessZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessZone" ADD CONSTRAINT "AccessZone_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessScan" ADD CONSTRAINT "AccessScan_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "AccessZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TicketTypeZones" ADD CONSTRAINT "_TicketTypeZones_A_fkey" FOREIGN KEY ("A") REFERENCES "AccessZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TicketTypeZones" ADD CONSTRAINT "_TicketTypeZones_B_fkey" FOREIGN KEY ("B") REFERENCES "TicketType"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Datos de antes: una entrada usada entró una vez y sigue adentro (sin salidas, como hasta ahora).
UPDATE "Ticket" SET "entries" = 1, "inside" = true, "lastMovementAt" = "usedAt" WHERE "status" = 'USED';
