-- Tarjetas y manillas NFC vinculadas a una entrada en el canje: el número de serie (UID) para encontrarla en la puerta,
-- la huella completa que leyó la app y quién y cuándo la vinculó. Todo opcional: lo anterior no cambia.

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "nfcUid" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "nfcCard" JSONB;
ALTER TABLE "Ticket" ADD COLUMN "nfcLinkedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "nfcLinkedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_sessionId_nfcUid_key" ON "Ticket"("sessionId", "nfcUid");
