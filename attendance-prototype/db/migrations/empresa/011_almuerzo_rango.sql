-- 011_almuerzo_rango.sql — El almuerzo se escribe como un RANGO.
--
-- La 010 guardó a qué hora empieza el almuerzo, junto a los minutos que dura.
-- Son el mismo dato dicho de dos formas, y así es fácil dejarlos peleados: se
-- edita la duración, la hora de fin no se entera, y nadie sabe cuál manda.
--
-- Ahora se escribe como la jornada —«de 13:00 a 14:00»— y la duración sale de
-- ahí. `almuerzo_min` se conserva porque lo lee todo el resto del sistema (las
-- horas esperadas del día, los resúmenes del panel), pero deja de ser algo que
-- alguien teclee: se calcula del rango.
--
-- Aquí solo se completa la hora de FIN de los almuerzos que ya tienen inicio:
-- inicio + su duración. Un día sin pausa se queda sin rango.

update horarios set dias = (
  select jsonb_object_agg(k, case
    when v ? 'almuerzo_desde' and (v->>'almuerzo_min')::int > 0
      then v || jsonb_build_object('almuerzo_hasta', to_char(
             (v->>'almuerzo_desde')::time + make_interval(mins => (v->>'almuerzo_min')::int),
             'HH24:MI'))
    else v end)
  from jsonb_each(dias) as e(k, v))
where dias is not null;

-- La copia que lleva cada empleado (la asignación de horario es POR COPIA).
update empleados set jornada_dias = (
  select jsonb_object_agg(k, case
    when v ? 'almuerzo_desde' and (v->>'almuerzo_min')::int > 0
      then v || jsonb_build_object('almuerzo_hasta', to_char(
             (v->>'almuerzo_desde')::time + make_interval(mins => (v->>'almuerzo_min')::int),
             'HH24:MI'))
    else v end)
  from jsonb_each(jornada_dias) as e(k, v))
where jornada_dias is not null;
