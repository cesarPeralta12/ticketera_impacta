-- Sesiones revocables: versión de sesión por cuenta y tokens de renovación en los teléfonos.
ALTER TABLE "StaffUser" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "DeviceToken"
  ADD COLUMN "refreshHash" TEXT,
  ADD COLUMN "prevRefreshHash" TEXT,
  ADD COLUMN "refreshExpiresAt" TIMESTAMP(3),
  ADD COLUMN "rotatedAt" TIMESTAMP(3),
  ADD COLUMN "ip" TEXT,
  ADD COLUMN "appVersion" TEXT,
  ADD COLUMN "platform" TEXT;

CREATE UNIQUE INDEX "DeviceToken_refreshHash_key" ON "DeviceToken"("refreshHash");
CREATE UNIQUE INDEX "DeviceToken_prevRefreshHash_key" ON "DeviceToken"("prevRefreshHash");
