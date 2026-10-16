-- Plano de boliche: elementos del recinto que no se venden (escenario, barras, DJ, entrada, baños, textos).

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "mapItems" JSONB;

