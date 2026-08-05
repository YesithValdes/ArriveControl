-- 003_jornada_semanal.sql
-- Jornada DISTRIBUIDA por empleado (Ley 2101: las 42 h semanales pueden
-- repartirse distinto entre los días por acuerdo — p. ej. 7.5 h L–V + 4.5 h
-- el sábado). La extra del día se calcula contra la jornada pactada de ESE
-- día, no contra un 7 fijo.
--
-- 6 valores: [lun, mar, mié, jue, vie, sáb]. El domingo no se pacta (día no
-- laboral: todo lo trabajado es extra, regla pendiente del RIT).
-- NULL = jornada estándar (las horas/día de la ley vigente, hoy 7).
alter table asistencia.empleados
  add column if not exists jornada_semanal real[]
  check (jornada_semanal is null or (
    array_length(jornada_semanal, 1) = 6
    and 0 <= all(jornada_semanal)
    and 12 >= all(jornada_semanal)
  ));
