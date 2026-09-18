-- control/014_roles_tres.sql
--
-- Tres roles DENTRO de la empresa (antes era uno solo, «empresa», con todo):
--   empresa  → Dueño: todo, incluida la cuenta (plan, clave de API, gente).
--   admin    → Administrador: la operación (asistencia, correcciones,
--              colaboradores, horarios, sedes, dispositivos, reglamento,
--              cerrar períodos). No toca la cuenta ni invita.
--   consulta → Consulta: solo ver (asistencia, reportes, historial, exportar).
-- superadmin sigue siendo de la plataforma. Quien ya existía queda como
-- dueño (así estaba). Las invitaciones llevan el rol con que entrará la
-- persona; sin decirlo, entra como consulta.
alter table control."user" drop constraint if exists user_rol_check;
alter table control."user"
  add constraint user_rol_check check (rol in ('superadmin', 'empresa', 'admin', 'consulta'));

alter table control.invitaciones drop constraint if exists invitaciones_rol_check;
alter table control.invitaciones
  add constraint invitaciones_rol_check check (rol in ('empresa', 'admin', 'consulta'));
alter table control.invitaciones alter column rol set default 'consulta';
