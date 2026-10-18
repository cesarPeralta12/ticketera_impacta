
-- CreateTable
CREATE TABLE "VenuePlanImage" (
    "venueId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "opacity" INTEGER NOT NULL DEFAULT 40,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenuePlanImage_pkey" PRIMARY KEY ("venueId")
);

-- AddForeignKey
ALTER TABLE "VenuePlanImage" ADD CONSTRAINT "VenuePlanImage_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

