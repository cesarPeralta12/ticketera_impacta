-- Límite de eventos activos por organizador (nulo = sin límite).
ALTER TABLE "Organization" ADD COLUMN "maxActiveEvents" INTEGER;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_maxActiveEvents_check" CHECK ("maxActiveEvents" IS NULL OR "maxActiveEvents" >= 0);
