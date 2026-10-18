
-- CreateTable
CREATE TABLE "SeatHold" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7C3AED',
    "code" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatHoldSeat" (
    "holdId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,

    CONSTRAINT "SeatHoldSeat_pkey" PRIMARY KEY ("holdId","seatId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeatHold_sessionId_name_key" ON "SeatHold"("sessionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SeatHold_sessionId_code_key" ON "SeatHold"("sessionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SeatHoldSeat_sessionId_seatId_key" ON "SeatHoldSeat"("sessionId", "seatId");

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHoldSeat" ADD CONSTRAINT "SeatHoldSeat_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "SeatHold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHoldSeat" ADD CONSTRAINT "SeatHoldSeat_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

