-- 010_hora_almuerzo.sql — A QUÉ HORA se almuerza, no solo cuánto dura.
--
-- El horario por día guardaba `almuerzo_min` (cuánto dura) pero nunca la hora
-- en que empieza. Hacía falta para cerrar el día de quien entra en la mañana
-- y no vuelve a marcar: sin su salida a almorzar, lo único que consta es la
-- mañana, y hay que saber hasta qué hora contarla.
--
-- Mientras no existía, esa hora se DEDUCÍA partiendo por la mitad las horas
-- de trabajo del día. Deducirla no sirve: hay gente con una hora de almuerzo
-- y gente con dos, y el punto medio no cae donde debe en ninguno de los dos
-- casos. Ahora se guarda y se edita.
--
-- Los horarios que ya existen se rellenan con la MISMA hora que se venía
-- deduciendo, para que ningún cálculo cambie de un día para otro; a partir de
-- ahí se corrige a mano desde Ajustes → Horarios.
--
-- Un día sin almuerzo (almuerzo_min = 0, como el sábado 09:00–13:30) se queda
-- SIN hora: no hay pausa que marcar, y su tope sigue siendo el fin de jornada.

-- Punto medio de las horas de TRABAJO del día: entrada + (salida − entrada −
-- almuerzo) / 2. Es exactamente lo que hacía el código hasta ahora.
create or replace function _almuerzo_deducido(entrada text, salida text, mins int)
returns text language sql immutable as $$
  select to_char(
    (entrada::time + make_interval(mins => (
      (extract(epoch from salida::time - entrada::time)::int / 60 - mins) / 2
    ))), 'HH24:MI')
$$;

-- Plantillas de horario.
update horarios set dias = (
  select jsonb_object_agg(k, case
    when (v->>'almuerzo_min')::int > 0
      then v || jsonb_build_object('almuerzo_desde',
             _almuerzo_deducido(v->>'entrada', v->>'salida', (v->>'almuerzo_min')::int))
    else v end)
  from jsonb_each(dias) as e(k, v))
where dias is not null;

-- La copia que lleva cada empleado (la asignación de horario es POR COPIA).
update empleados set jornada_dias = (
  select jsonb_object_agg(k, case
    when (v->>'almuerzo_min')::int > 0
      then v || jsonb_build_object('almuerzo_desde',
             _almuerzo_deducido(v->>'entrada', v->>'salida', (v->>'almuerzo_min')::int))
    else v end)
  from jsonb_each(jornada_dias) as e(k, v))
where jornada_dias is not null;

drop function _almuerzo_deducido(text, text, int);
