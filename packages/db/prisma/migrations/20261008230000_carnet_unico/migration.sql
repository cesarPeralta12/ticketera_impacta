-- Carnet obligatorio para comprar y único por cuenta (una persona, una cuenta).
-- Normaliza los carnets existentes y, si dos cuentas tenían el mismo, la más nueva lo pierde:
-- tendrá que completarlo de nuevo antes de comprar.

UPDATE "Customer"
SET "documentId" = upper(regexp_replace("documentId", '[\s.\-]', '', 'g'))
WHERE "documentId" IS NOT NULL;

UPDATE "Customer" c
SET "documentId" = NULL
WHERE c."documentId" IS NOT NULL
  AND (c."documentId" = '' OR EXISTS (
    SELECT 1 FROM "Customer" o
    WHERE o."documentId" = c."documentId"
      AND (o."createdAt" < c."createdAt" OR (o."createdAt" = c."createdAt" AND o."id" < c."id"))
  ));

-- CreateIndex
CREATE UNIQUE INDEX "Customer_documentId_key" ON "Customer"("documentId");
