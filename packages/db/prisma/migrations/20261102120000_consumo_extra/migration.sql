-- Consumo extra al comprar: el organizador define paquetes por tipo de entrada, el comprador elige uno y el QR de
-- consumo lleva el total (incluido + extra). Las órdenes y vales que ya existen quedan igual (extra = 0).

-- AlterTable
ALTER TABLE "TicketType" ADD COLUMN "extraConsumptionOptions" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "extraConsumption" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ConsumptionCredit" ADD COLUMN "extraAmount" INTEGER NOT NULL DEFAULT 0;
