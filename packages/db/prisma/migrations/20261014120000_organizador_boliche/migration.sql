-- Tipo de organizador: eventos o boliche. Aditiva: los existentes quedan como eventos.

-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('EVENTS', 'NIGHTLIFE');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "kind" "OrganizationKind" NOT NULL DEFAULT 'EVENTS';

