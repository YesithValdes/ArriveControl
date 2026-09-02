-- control/012_tareas.sql — Bitácora de las tareas programadas.
--
-- El envío del resumen diario no llegó una noche y no hubo forma de saber si
-- la tarea no corrió, corrió y falló, o corrió y no encontró a quién
-- escribirle. Los registros de Vercel son efímeros: al día siguiente ya no
-- estaban.
--
-- Una tarea que corre sola de madrugada, sin nadie mirando, y que además
-- MANDA CORREOS A LOS EMPLEADOS DE TODAS LAS EMPRESAS, tiene que dejar
-- rastro propio. Si no, la única señal de que algo se rompió es que un
-- cliente lo note primero.
--
-- Vive en `control` y no en el esquema de cada empresa porque la tarea es de
-- la plataforma: recorre todas.

create table if not exists control.tareas (
  id          uuid primary key default gen_random_uuid(),

  -- Qué tarea. Hoy solo 'resumen-diario', pero van a venir más (avisos de
  -- vencimiento de prueba, cobros) y todas merecen la misma bitácora.
  tarea       text not null,

  -- Sobre qué día trabajó. Permite responder «¿se envió lo del lunes?» sin
  -- tener que mirar la hora en que corrió, que puede ser de otro día.
  sobre       date,

  -- 'ok' | 'error'. El resultado, no si respondió 200: una tarea puede
  -- terminar bien y no haber hecho nada, y eso también es información.
  estado      text not null,

  -- El resumen de lo que hizo: cuántos correos salieron, cuántos fallaron,
  -- cuántas empresas se recorrieron. Se guarda entero para poder investigar
  -- un caso raro meses después sin haber previsto la pregunta.
  detalle     jsonb,

  duracion_ms integer,
  creado_en   timestamptz not null default now()
);

-- La pregunta normal es «¿cuándo corrió esto por última vez?».
create index if not exists tareas_recientes_idx on control.tareas (tarea, creado_en desc);
