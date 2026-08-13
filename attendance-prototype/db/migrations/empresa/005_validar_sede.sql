-- 005_validar_sede.sql — Sede asignada ≠ dónde puede marcar.
--
-- La sede del empleado es ORGANIZATIVA (dónde trabaja, para reportes y
-- comparativas). Este flag dice si además se le EXIGE marcar en su sede:
-- con él apagado (el valor por defecto, que conserva el comportamiento
-- actual), la persona puede marcar desde cualquier kiosco o lugar.
alter table empleados
  add column if not exists validar_sede boolean not null default false;
