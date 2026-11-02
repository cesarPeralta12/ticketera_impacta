-- Etapa en la que se vendió cada línea de una orden (preventa, fase, venta), congelada al comprar. Opcional: lo anterior
-- no la tiene y se estima con las fechas del tipo de entrada.

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "saleStage" TEXT;
