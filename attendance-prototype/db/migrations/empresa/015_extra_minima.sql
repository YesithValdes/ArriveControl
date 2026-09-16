-- empresa/015_extra_minima.sql
--
-- Mínimo de hora extra que se liquida, en MINUTOS, a elección de la empresa:
-- un exceso (de la semana o del día, según el modo) por debajo de esto se
-- descarta entero; por encima, entra completo. Antes era fijo en 30 min.
-- 0 = sin mínimo (cada minuto de más es extra).
--
-- Es un parámetro de pago: lleva vigencia. Una vigencia sin valor (las
-- anteriores a esta migración) cuenta como 30, que es lo que regía.
alter table config_laboral
  add column if not exists extra_minima_min integer not null default 30
  check (extra_minima_min between 0 and 120);

alter table valorizacion_vigencias
  add column if not exists extra_minima_min integer
  check (extra_minima_min between 0 and 120);
