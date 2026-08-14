-- 008_direccion_marcacion.sql — Dirección legible de la marcación.
--
-- La geocodificación inversa (lat/lon → "Cra 26 #18-45, Pasto") se resuelve
-- UNA vez en el servidor después de registrar, y queda guardada para que el
-- panel y el comprobante muestren un lugar con nombre y no coordenadas.
alter table marcaciones
  add column if not exists direccion text;
