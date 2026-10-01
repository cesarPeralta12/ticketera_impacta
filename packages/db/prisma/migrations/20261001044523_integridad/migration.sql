-- Reglas de integridad que Prisma no puede expresar en el esquema.
-- Son la última barrera: si un bug intenta guardar un dato imposible, la base lo rechaza.

ALTER TABLE "Section"    ADD CONSTRAINT "Section_capacity_check"     CHECK ("capacity" >= 0);
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_capacity_check"  CHECK ("capacity" >= 0);
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_amount_check"    CHECK ("unitAmount" >= 0);
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_maxPerOrder_check" CHECK ("maxPerOrder" >= 1);
ALTER TABLE "OrderItem"  ADD CONSTRAINT "OrderItem_quantity_check"   CHECK ("quantity" >= 1);
ALTER TABLE "OrderItem"  ADD CONSTRAINT "OrderItem_amount_check"     CHECK ("unitAmount" >= 0);
ALTER TABLE "Order"      ADD CONSTRAINT "Order_amounts_check"
  CHECK ("subtotalAmount" >= 0 AND "feeAmount" >= 0 AND "totalAmount" = "subtotalAmount" + "feeAmount");
ALTER TABLE "Payment"    ADD CONSTRAINT "Payment_amount_check"       CHECK ("amount" >= 0);

-- Un asiento no puede tener dos entradas vigentes en la misma función.
CREATE UNIQUE INDEX "Ticket_session_seat_active_key"
  ON "Ticket" ("sessionId", "seatId")
  WHERE "seatId" IS NOT NULL AND "status" <> 'CANCELLED';
