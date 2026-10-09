-- empresa/024_foto_marcacion.sql
--
-- Foto del REGISTRO: el cuadro de la cámara en el momento en que el kiosco
-- confirmó la identidad, guardado junto a la marcación como evidencia para el
-- panel. No participa en el reconocimiento (eso son los descriptores de
-- `rostros`). Se guarda ya normalizada (JPEG de 320 px de lado mayor, unos
-- 15–25 KB). Marcaciones manuales o de kioscos viejos quedan sin foto.
alter table marcaciones
  add column if not exists foto bytea;
