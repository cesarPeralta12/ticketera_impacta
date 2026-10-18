-- Datos para el comprador: último ingreso y programa de la función, cómo llegar al recinto, condiciones y contacto del evento.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "dressCode" TEXT,
ADD COLUMN     "forbiddenItems" TEXT,
ADD COLUMN     "minAge" INTEGER,
ADD COLUMN     "reentryPolicy" TEXT,
ADD COLUMN     "refundPolicy" TEXT,
ADD COLUMN     "requiredDocument" TEXT;

-- AlterTable
ALTER TABLE "EventSession" ADD COLUMN     "lastEntryAt" TIMESTAMP(3),
ADD COLUMN     "program" JSONB;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "accessibility" TEXT,
ADD COLUMN     "directions" TEXT,
ADD COLUMN     "mapUrl" TEXT,
ADD COLUMN     "parking" TEXT;

