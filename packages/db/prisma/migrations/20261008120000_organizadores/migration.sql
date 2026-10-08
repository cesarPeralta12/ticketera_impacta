-- Varios organizadores bajo IMPACTA: cada uno es una organización aislada; IMPACTA es la plataforma.
-- Aditiva: no borra ni renombra nada.

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterEnum
ALTER TYPE "EventStatus" ADD VALUE 'PENDING_REVIEW';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "isPlatform" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "taxId" TEXT;

-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TicketType" ADD COLUMN     "presale" BOOLEAN NOT NULL DEFAULT false;


-- IMPACTA (la organización existente) es la dueña de la plataforma.
UPDATE "Organization" SET "isPlatform" = true WHERE "slug" = 'impacta';
-- Si la base no tiene una organización 'impacta', la plataforma es la primera que se creó.
UPDATE "Organization" SET "isPlatform" = true
WHERE "id" = (SELECT "id" FROM "Organization" ORDER BY "createdAt" ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "Organization" WHERE "isPlatform" = true);
