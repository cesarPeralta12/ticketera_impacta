-- Integración con el prototipo del compañero: login, categorías, diseño de secciones y cola virtual.
--
-- Contraseñas: las cuentas que ya existan reciben el hash "!", que bcrypt nunca acepta,
-- así que deben restablecer su contraseña. Luego se quita el valor por defecto para que
-- toda cuenta nueva tenga que traer su propio hash.
-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('CONCIERTO', 'TEATRO', 'FESTIVAL', 'DEPORTES', 'CONFERENCIA', 'FIESTA', 'ARTE', 'OTRO');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT '!';
ALTER TABLE "Customer" ALTER COLUMN "passwordHash" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "category" "EventCategory" NOT NULL DEFAULT 'OTRO';

-- AlterTable
ALTER TABLE "EventSession" ADD COLUMN     "maxConcurrentCheckouts" INTEGER,
ADD COLUMN     "queueEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#F5B700',
ADD COLUMN     "layout" JSONB;

-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT '!';
ALTER TABLE "StaffUser" ALTER COLUMN "passwordHash" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Venue" ALTER COLUMN "timezone" SET DEFAULT 'America/La_Paz';

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueueEntry_sessionId_admittedAt_joinedAt_idx" ON "QueueEntry"("sessionId", "admittedAt", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_sessionId_token_key" ON "QueueEntry"("sessionId", "token");

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
