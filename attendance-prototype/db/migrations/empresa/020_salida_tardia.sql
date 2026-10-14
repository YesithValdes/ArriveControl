-- empresa/020_salida_tardia.sql
--
-- Tolerancia de la anomalía «Salida tardía», en MINUTOS: una salida marcada
-- más de esto después del fin del horario se avisa en Anomalías.
--
-- NULL = igual a la extra mínima (extra_minima_min). Es el valor de fábrica:
-- así se avisa justo lo que puede llegar a liquidarse como extra.
--
-- No es parámetro de pago (no cambia ninguna hora, solo qué se avisa), por
-- eso no lleva vigencia.
alter table config_laboral
  add column if not exists salida_tarde_min integer
  check (salida_tarde_min between 0 and 240);
