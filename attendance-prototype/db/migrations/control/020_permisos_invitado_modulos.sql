-- control/020_permisos_invitado_modulos.sql
--
-- Los permisos del Invitado pasan de acciones generales (ver, corregir,
-- empleados, config, liquidar) a una matriz MÓDULO × (ver | gestionar),
-- con claves `modulo:ver` / `modulo:gestionar` (lib/roles.js,
-- MODULOS_INVITADO). Lo que cada empresa ya tenía se traduce a lo mismo:
-- `config` cubría horarios, sedes, dispositivos y reglamento.
alter table control.empresas alter column permisos_invitado set default array[
  'asistencia:ver', 'marcaciones:ver', 'marcaciones:gestionar',
  'colaboradores:ver', 'colaboradores:gestionar',
  'horarios:ver', 'horarios:gestionar', 'sedes:ver', 'sedes:gestionar',
  'dispositivos:ver', 'dispositivos:gestionar',
  'reglamento:ver', 'reglamento:gestionar', 'cierres:ver', 'cierres:gestionar'
];

update control.empresas set permisos_invitado =
  array['asistencia:ver', 'marcaciones:ver', 'horarios:ver', 'sedes:ver', 'reglamento:ver', 'cierres:ver', 'colaboradores:ver', 'dispositivos:ver']
  || case when 'corregir'  = any(permisos_invitado) then array['marcaciones:gestionar'] else array[]::text[] end
  || case when 'empleados' = any(permisos_invitado) then array['colaboradores:gestionar'] else array[]::text[] end
  || case when 'config'    = any(permisos_invitado) then array['horarios:gestionar', 'sedes:gestionar', 'dispositivos:gestionar', 'reglamento:gestionar'] else array[]::text[] end
  || case when 'liquidar'  = any(permisos_invitado) then array['cierres:gestionar'] else array[]::text[] end
 where not exists (select 1 from unnest(permisos_invitado) p where p like '%:%');
