-- Secciones borradas que tuvieron ventas, todas anuladas: dejan de verse y de venderse, pero sus ventas anuladas
-- siguen en los reportes.

-- AlterTable
ALTER TABLE "Section" ADD COLUMN "archivedAt" TIMESTAMP(3);
