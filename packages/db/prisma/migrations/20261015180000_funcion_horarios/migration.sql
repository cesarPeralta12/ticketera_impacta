-- Función: hora de llegada recomendada (la de fin y la ventana de venta ya existían, ahora se cargan en el panel).

-- AlterTable
ALTER TABLE "EventSession" ADD COLUMN     "arrivalAt" TIMESTAMP(3);
