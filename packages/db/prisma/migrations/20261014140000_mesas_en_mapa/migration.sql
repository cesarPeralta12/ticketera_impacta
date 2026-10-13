-- Mesas elegidas en el mapa: el saldo de la mesa guarda su butaca (la mesa de la sección numerada).

-- AlterTable
ALTER TABLE "ConsumptionCredit" ADD COLUMN     "seatId" TEXT;

-- AddForeignKey
ALTER TABLE "ConsumptionCredit" ADD CONSTRAINT "ConsumptionCredit_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

