-- Registro de seguridad: de qué organización, con qué gravedad y desde dónde (IP, navegador, teléfono).
ALTER TABLE "AuditLog"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'info',
  ADD COLUMN "ip" TEXT,
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "deviceId" TEXT,
  ADD COLUMN "deviceName" TEXT;

CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_ip_createdAt_idx" ON "AuditLog"("ip", "createdAt");
