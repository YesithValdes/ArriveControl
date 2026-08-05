-- 002_horas_dia.sql
-- Regla de negocio real: la jornada se controla POR DÍA (6 días × 7 horas).
-- Lo que exceda las horas del día son extras de ese día; el domingo es
-- especial completo. `horas_semana` se conserva para las vistas semanales
-- del panel, pero la liquidación usa `horas_dia`.
alter table asistencia.config_laboral
  add column if not exists horas_dia integer not null default 7
  check (horas_dia between 1 and 12);
