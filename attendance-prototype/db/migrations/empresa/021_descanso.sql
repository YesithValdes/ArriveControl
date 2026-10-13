-- empresa/021_descanso.sql
--
-- Descanso (almuerzo) de la empresa, en MINUTOS, y su tolerancia.
--
--  · descanso_min: con cuánto descanso nace un horario nuevo. Antes estaba
--    fijo en 60 en el código. Los horarios ya creados no cambian: cada uno
--    guarda su propio rango de almuerzo.
--  · descanso_tolerancia_min: minutos de más sobre el descanso del horario
--    que no se avisan. Pasado eso, el panel muestra la anomalía «Descanso
--    excedido». Es solo un aviso: no interviene en el cálculo de horas.
--
-- No son parámetros de pago: no llevan vigencia.
alter table config_laboral
  add column if not exists descanso_min integer not null default 60
  check (descanso_min between 0 and 240);

alter table config_laboral
  add column if not exists descanso_tolerancia_min integer not null default 10
  check (descanso_tolerancia_min between 0 and 120);
