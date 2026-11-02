-- Entradas que ya existen fuera de iPass: el código del tercero (y su clave para leerlo en la puerta) en cada
-- entrada importada, y el origen y la regla de lectura en cada lote. Todo opcional: lo anterior no cambia.

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "externalCode" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "externalKey" TEXT;

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN "sourceName" TEXT;
ALTER TABLE "ImportBatch" ADD COLUMN "codeRule" JSONB;
ALTER TABLE "ImportBatch" ADD COLUMN "mapping" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_sessionId_externalKey_key" ON "Ticket"("sessionId", "externalKey");
