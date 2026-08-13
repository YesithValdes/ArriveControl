-- 006_horarios_por_dia.sql — Horarios personalizados POR DÍA de la semana.
--
-- Un horario deja de ser una sola franja fija: pasa a ser un mapa
--   { "0".."6": { entrada, salida, almuerzo_min } }   (0=domingo … 6=sábado)
-- donde un día ausente es día LIBRE. Así una misma persona puede trabajar
-- lunes 08:00–17:00 y sábado 08:00–12:00 con el mismo horario.
--
-- Los horarios existentes se migran a lunes–viernes con su franja anterior.
--
-- La asignación sigue siendo POR COPIA: al asignar un horario, el mapa se
-- copia a empleados.jornada_dias y los cálculos leen del empleado. Los campos
-- uniformes (entrada_esperada/salida_esperada/almuerzo_min) quedan como
-- respaldo para los empleados ya registrados; con jornada_dias presente,
-- manda el día de la semana.

alter table horarios add column if not exists dias jsonb;

update horarios set dias = (
  select jsonb_object_agg(d::text, jsonb_build_object(
    'entrada', entrada, 'salida', salida, 'almuerzo_min', almuerzo_min))
  from generate_series(1, 5) d
) where dias is null;

alter table horarios alter column dias set not null;

alter table horarios
  drop column if exists entrada,
  drop column if exists salida,
  drop column if exists almuerzo_min;

alter table empleados add column if not exists jornada_dias jsonb;
