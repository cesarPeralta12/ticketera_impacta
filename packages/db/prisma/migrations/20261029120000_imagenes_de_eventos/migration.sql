-- Fotos de eventos subidas desde el panel (además de pegar un enlace).

-- CreateTable
CREATE TABLE "EventImage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventImage_organizationId_idx" ON "EventImage"("organizationId");

-- AddForeignKey
ALTER TABLE "EventImage" ADD CONSTRAINT "EventImage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
