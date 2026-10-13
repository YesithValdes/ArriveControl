-- Expandir permisos anteriores sin volver a conceder acciones revocadas.
update control.empresas e set permisos_invitado = (
 select array_agg(distinct permiso) from (
   select p as permiso from unnest(e.permisos_invitado) p where p not like '%:gestionar'
   union select split_part(p, ':', 1) || ':' || a from unnest(e.permisos_invitado) p cross join unnest(array['ver','crear','editar','eliminar']) a
     where p like '%:gestionar' and (split_part(p, ':', 1) not in ('reglamento','cierres') or (split_part(p, ':', 1) = 'reglamento' and a in ('ver','editar')) or (split_part(p, ':', 1) = 'cierres' and a in ('ver','crear','eliminar')))
   union select 'novedades:' || a from unnest(array['ver','crear','eliminar']) a where 'colaboradores:gestionar' = any(e.permisos_invitado)
   union select 'asistencia:ver'
 ) permisos
) where permisos_invitado is not null;
alter table control.empresas alter column permisos_invitado set default array['asistencia:ver', 'marcaciones:ver', 'marcaciones:crear', 'marcaciones:editar', 'marcaciones:eliminar', 'colaboradores:ver', 'colaboradores:crear', 'colaboradores:editar', 'colaboradores:eliminar', 'horarios:ver', 'horarios:crear', 'horarios:editar', 'horarios:eliminar', 'sedes:ver', 'sedes:crear', 'sedes:editar', 'sedes:eliminar', 'dispositivos:ver', 'dispositivos:crear', 'dispositivos:editar', 'dispositivos:eliminar', 'reglamento:ver', 'reglamento:editar', 'cierres:ver', 'cierres:crear', 'cierres:eliminar', 'novedades:ver', 'novedades:crear', 'novedades:eliminar'];
