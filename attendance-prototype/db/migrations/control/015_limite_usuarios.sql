-- control/015_limite_usuarios.sql — Cupo de accesos al panel por acuerdo.
--
-- Cuántas personas pueden entrar al panel lo dice el plan (lib/planes.js).
-- Igual que con `limite_empleados`, hay acuerdos puntuales que se salen del
-- catálogo: un cliente del plan Equipo que necesita un cuarto acceso sin
-- pasar a Empresa. NULL = rige el del plan.
alter table control.empresas
  add column if not exists limite_usuarios integer check (limite_usuarios is null or limite_usuarios >= 1);
