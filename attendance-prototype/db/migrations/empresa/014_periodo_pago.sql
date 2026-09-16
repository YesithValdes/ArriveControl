-- empresa/014_periodo_pago.sql
--
-- Cada cuánto liquida la empresa las horas extra: 'quincena' (1–15 y 16–fin)
-- o 'mes'. Es presentación, no cálculo: agrupa el reporte de horas extra por
-- períodos de pago y el rango por defecto del dashboard. No lleva vigencia.
alter table config_laboral
  add column if not exists periodo_pago text not null default 'quincena'
  check (periodo_pago in ('quincena', 'mes'));
