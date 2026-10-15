-- La foto del registro (024_foto_marcacion.sql) es un dato biométrico: se
-- guarda mientras sirve como evidencia y luego se borra (lib/retencionFotos.js,
-- 90 días). La MARCACIÓN se queda para siempre; solo se vacía `foto`.
--
-- `foto_retenida` la saca de esa limpieza: una foto que hace parte de un
-- reclamo o una investigación abierta no puede desaparecer a mitad de camino.
alter table marcaciones
  add column if not exists foto_retenida boolean not null default false;

-- Solo las filas que todavía tienen foto: el índice se encoge a medida que la
-- limpieza avanza.
create index if not exists marcaciones_ts_con_foto_idx
  on marcaciones (ts) where foto is not null;
