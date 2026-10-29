-- Fases de venta (Fase Hot, Fase 1…): cada fase es un precio de su sección con su orden y, opcional, su fecha.
ALTER TABLE "TicketType" ADD COLUMN "phaseOrder" INTEGER;
ALTER TABLE "TicketType" ADD COLUMN "phaseStartsAt" TIMESTAMP(3);
