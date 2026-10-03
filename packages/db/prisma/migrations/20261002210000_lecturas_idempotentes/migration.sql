-- Id de lectura generado por la app de puerta: reenviar una lectura al sincronizar no la duplica.
-- AlterTable
ALTER TABLE "AccessScan" ADD COLUMN     "clientScanId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AccessScan_clientScanId_key" ON "AccessScan"("clientScanId");
