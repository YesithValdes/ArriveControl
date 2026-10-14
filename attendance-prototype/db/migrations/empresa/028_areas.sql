-- empresa/028_areas.sql
--
-- En pantalla los «equipos» pasan a llamarse «áreas» (Marketing, Ventas,
-- Soporte…). Las tablas conservan su nombre para no romper permisos ni
-- respaldos; aquí solo se agrega lo que muestra la nueva vista:
--   · responsable_id  quién está a cargo (opcional; si se va, queda sin responsable)
--   · activa          un área inactiva conserva sus integrantes pero se marca así
--   · color           el punto que la distingue en la lista
alter table equipos
  add column if not exists responsable_id text references empleados(id) on delete set null,
  add column if not exists activa boolean not null default true,
  add column if not exists color text not null default '#2b6cb0'
    check (color ~ '^#[0-9a-f]{6}$');
