-- Material promocional del evento para los promotores (una imagen o un video por evento, original; se borra 30 días después del evento).

-- CreateTable
CREATE TABLE "EventPromoAsset" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "thumb" BYTEA,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventPromoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventPromoAsset_eventId_key" ON "EventPromoAsset"("eventId");

-- AddForeignKey
ALTER TABLE "EventPromoAsset" ADD CONSTRAINT "EventPromoAsset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Códigos antiguos con solo el nombre del promotor: se ligan a su cuenta cuando hay exactamente una cuenta de promotor
-- de la misma organización con ese nombre (sin distinguir mayúsculas). Los demás quedan "sin cuenta" para ligarlos a mano.
UPDATE "PromoCode" p
SET "promoterId" = m."userId"
FROM (
    SELECT mem."organizationId", lower(trim(u."name")) AS nm, min(u."id") AS "userId", count(*) AS n
    FROM "Membership" mem
    JOIN "StaffUser" u ON u."id" = mem."userId"
    WHERE mem."role" = 'PROMOTER' AND u."active" = true
    GROUP BY mem."organizationId", lower(trim(u."name"))
) m
WHERE p."promoterId" IS NULL
  AND p."promoterName" IS NOT NULL
  AND m."organizationId" = p."organizationId"
  AND m.nm = lower(trim(p."promoterName"))
  AND m.n = 1;
