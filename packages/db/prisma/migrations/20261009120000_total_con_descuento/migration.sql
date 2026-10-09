-- El total de una orden ahora puede incluir el descuento de un código promocional:
-- total = subtotal - descuento + cargo por servicio, y el descuento nunca supera el subtotal.
ALTER TABLE "Order" DROP CONSTRAINT "Order_amounts_check";
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_check"
  CHECK (
    "subtotalAmount" >= 0 AND "feeAmount" >= 0
    AND "discountAmount" >= 0 AND "discountAmount" <= "subtotalAmount"
    AND "totalAmount" = "subtotalAmount" - "discountAmount" + "feeAmount"
  );
