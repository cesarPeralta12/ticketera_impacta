-- Emparejamientos de columnas guardados por organización, para repetir una importación con el mismo proveedor.

-- CreateTable
CREATE TABLE "ImportFormat" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceName" TEXT,
    "readMethod" TEXT NOT NULL DEFAULT 'QR',
    "mapping" JSONB NOT NULL,
    "titles" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportFormat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportFormat_organizationId_name_key" ON "ImportFormat"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "ImportFormat" ADD CONSTRAINT "ImportFormat_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
