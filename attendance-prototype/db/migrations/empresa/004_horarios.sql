-- 004_horarios.sql — Horarios con nombre, gestionables desde el panel.
--
-- Un horario es una PLANTILLA de jornada (entrada, salida, almuerzo) con
-- nombre propio ("Administrativo", "Turno tarde"). Al asignarlo a un empleado
-- sus valores se COPIAN a entrada_esperada/salida_esperada/almuerzo_min: los
-- cálculos de asistencia y nómina siguen leyendo del empleado, y editar la
-- plantilla después no reescribe jornadas ya pactadas.
create table if not exists horarios (
  id           text primary key default gen_random_uuid()::text,
  nombre       text not null unique,
  entrada      text not null check (entrada ~ '^\d{2}:\d{2}$'),
  salida       text not null check (salida ~ '^\d{2}:\d{2}$'),
  almuerzo_min int not null default 0 check (almuerzo_min between 0 and 240),
  creada_en    timestamptz not null default now()
);
