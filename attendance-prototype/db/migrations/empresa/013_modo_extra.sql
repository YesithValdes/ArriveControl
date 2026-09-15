-- empresa/013_modo_extra.sql
--
-- CÓMO se cuenta la hora extra, a elección de la empresa:
--   'semana' → lo que pase de horas_semana entre lunes y sábado, definido al
--              cerrar la semana (los días largos compensan los cortos).
--   'dia'    → lo que pase de la jornada del HORARIO de cada día, definido
--              al cerrar el día.
-- Domingo y festivo van con recargo desde la primera hora en los dos modos.
--
-- Lleva vigencia como los demás parámetros de pago: cambiar el modo en
-- octubre no recalcula lo de agosto. Una vigencia sin valor (las anteriores a
-- esta migración) cuenta como 'semana', que es lo que regía al crearla.
alter table config_laboral
  add column if not exists modo_extra text not null default 'semana'
  check (modo_extra in ('semana', 'dia'));

alter table valorizacion_vigencias
  add column if not exists modo_extra text
  check (modo_extra in ('semana', 'dia'));
