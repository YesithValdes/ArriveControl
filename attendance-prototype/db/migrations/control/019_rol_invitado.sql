-- control/019_rol_invitado.sql
--
-- Rol INVITADO: un cuarto rol de empresa cuyos permisos los decide cada
-- empresa. Por defecto puede lo mismo que el Administrador (ver, corregir,
-- empleados, config, liquidar) y el dueño apaga los que quiera. Nunca puede
-- más que el Administrador: `usuarios` y `cuenta` no se le pueden dar
-- (lib/roles.js filtra lo que se guarda aquí).
alter table control."user" drop constraint if exists user_rol_check;
alter table control."user"
  add constraint user_rol_check check (rol in ('superadmin', 'empresa', 'admin', 'consulta', 'invitado'));

alter table control.invitaciones drop constraint if exists invitaciones_rol_check;
alter table control.invitaciones
  add constraint invitaciones_rol_check check (rol in ('empresa', 'admin', 'consulta', 'invitado'));

alter table control.empresas
  add column if not exists permisos_invitado text[] not null
    default array['ver', 'corregir', 'empleados', 'config', 'liquidar'];
