-- La plataforma pasa a llamarse iPass. Solo se renombra la organización principal si todavía tiene el nombre
-- original (si alguien ya le puso otro, se respeta). El slug "impacta" no cambia: lo usan scripts internos.
UPDATE "Organization" SET "name" = 'iPass' WHERE "isPlatform" = true AND "name" = 'Impacta';
