-- Rol «Barra» y QR de consumo de un solo uso (el vale se lee una vez en la barra y queda marcado).

-- AlterEnum
ALTER TYPE "StaffRole" ADD VALUE 'BAR';

-- AlterTable: código del vale. Los saldos que ya existen reciben uno al azar (mismo alfabeto que las entradas).
ALTER TABLE "ConsumptionCredit" ADD COLUMN "code" TEXT;
ALTER TABLE "ConsumptionCredit" ADD COLUMN "redeemedAt" TIMESTAMP(3);

UPDATE "ConsumptionCredit" c
SET "code" = (
    SELECT string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
    FROM generate_series(1, 10) g
    WHERE c."id" IS NOT NULL
);

-- Lo que ya se descontó por completo cuenta como leído (la fecha del último cobro).
UPDATE "ConsumptionCredit" c
SET "redeemedAt" = COALESCE((SELECT max(r."createdAt") FROM "ConsumptionRedemption" r WHERE r."creditId" = c."id"), c."createdAt")
WHERE c."amount" > 0 AND c."spent" >= c."amount";

ALTER TABLE "ConsumptionCredit" ALTER COLUMN "code" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionCredit_code_key" ON "ConsumptionCredit"("code");
