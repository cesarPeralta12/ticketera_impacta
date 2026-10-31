-- Administración propia de un organizador o boliche: por defecto sus cuentas siguen siendo de solo lectura.
ALTER TABLE "Organization" ADD COLUMN "selfManaged" BOOLEAN NOT NULL DEFAULT false;
