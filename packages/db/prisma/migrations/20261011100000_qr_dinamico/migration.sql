-- QR dinámico: modo por tipo de entrada y dos resultados de lectura nuevos.
CREATE TYPE "QrMode" AS ENUM ('STATIC', 'DYNAMIC');
ALTER TABLE "TicketType" ADD COLUMN "qrMode" "QrMode" NOT NULL DEFAULT 'STATIC';
ALTER TYPE "ScanResult" ADD VALUE 'QR_EXPIRED';
ALTER TYPE "ScanResult" ADD VALUE 'STATIC_NOT_ALLOWED';
