-- Cajeros habilitados para canjear entradas por una tarjeta o manilla NFC.
ALTER TABLE "Membership" ADD COLUMN "canRedeemNfc" BOOLEAN NOT NULL DEFAULT false;
