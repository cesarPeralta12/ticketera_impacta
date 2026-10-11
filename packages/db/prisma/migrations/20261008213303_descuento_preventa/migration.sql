-- AlterTable
ALTER TABLE "TicketType" ADD COLUMN     "discountEndsAt" TIMESTAMP(3),
ADD COLUMN     "discountPercent" INTEGER,
ADD COLUMN     "discountStartsAt" TIMESTAMP(3);
