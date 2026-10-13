-- control/023_permisos_invitado_catalogo.sql
--
-- Catálogo nuevo de permisos del Invitado (lib/roles.js, MODULOS_INVITADO),
-- hecho sobre las acciones que de verdad existen en las rutas. Las listas
-- guardadas por persona se traducen UNA vez aquí, conservando lo que cada
-- quien ya podía hacer:
--   · asistencia:ver daba historial, anomalías, reportes y exportarlos;
--   · marcaciones:ver dejaba ver la foto de cada registro;
--   · novedades:ver dejaba bajar soportes; novedades:crear adjuntarlos y
--     decidir si se descuentan horas;
--   · colaboradores:editar dejaba cambiar la jornada (asignar horario);
--   · cierres:crear = cerrar y anotar pagos; cierres:eliminar = reabrir;
--   · reglamento:ver dejaba exportar todos los datos de la empresa.
-- Las claves que ya no existen las descarta lib/roles.js al leer.
create temporary table legado_invitado (viejo text, nuevo text) on commit drop;
insert into legado_invitado values
  ('asistencia:ver', 'asistencia:historial'), ('asistencia:ver', 'asistencia:anomalias'),
  ('asistencia:ver', 'asistencia:reportes'), ('asistencia:ver', 'asistencia:exportar'),
  ('marcaciones:ver', 'marcaciones:ver_foto'),
  ('marcaciones:gestionar', 'marcaciones:crear'), ('marcaciones:gestionar', 'marcaciones:editar'),
  ('marcaciones:gestionar', 'marcaciones:eliminar'),
  ('novedades:ver', 'novedades:soportes'),
  ('novedades:crear', 'novedades:soportes'), ('novedades:crear', 'novedades:descontar'),
  ('colaboradores:editar', 'horarios:asignar'),
  ('colaboradores:gestionar', 'colaboradores:crear'), ('colaboradores:gestionar', 'colaboradores:editar'),
  ('colaboradores:gestionar', 'colaboradores:eliminar'), ('colaboradores:gestionar', 'horarios:asignar'),
  ('colaboradores:gestionar', 'novedades:crear'), ('colaboradores:gestionar', 'novedades:eliminar'),
  ('colaboradores:gestionar', 'novedades:soportes'), ('colaboradores:gestionar', 'novedades:descontar'),
  ('horarios:gestionar', 'horarios:crear'), ('horarios:gestionar', 'horarios:editar'), ('horarios:gestionar', 'horarios:eliminar'),
  ('sedes:gestionar', 'sedes:crear'), ('sedes:gestionar', 'sedes:editar'), ('sedes:gestionar', 'sedes:eliminar'),
  ('dispositivos:gestionar', 'dispositivos:crear'), ('dispositivos:gestionar', 'dispositivos:editar'),
  ('dispositivos:gestionar', 'dispositivos:eliminar'),
  ('reglamento:gestionar', 'reglamento:editar'),
  ('reglamento:ver', 'seguridad:ver'), ('reglamento:ver', 'seguridad:exportar'),
  ('cierres:crear', 'cierres:cerrar'), ('cierres:crear', 'cierres:pagos'),
  ('cierres:eliminar', 'cierres:reabrir'),
  ('cierres:gestionar', 'cierres:cerrar'), ('cierres:gestionar', 'cierres:pagos'), ('cierres:gestionar', 'cierres:reabrir');

update control."user" u set permisos_invitado = (
  select array_agg(distinct p) from (
    select unnest(u.permisos_invitado) as p
    union select l.nuevo from legado_invitado l where l.viejo = any(u.permisos_invitado)
  ) t
) where u.permisos_invitado is not null;

update control.invitaciones i set permisos_invitado = (
  select array_agg(distinct p) from (
    select unnest(i.permisos_invitado) as p
    union select l.nuevo from legado_invitado l where l.viejo = any(i.permisos_invitado)
  ) t
) where i.permisos_invitado is not null;
