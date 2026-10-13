create table if not exists permisos (
 id text primary key default gen_random_uuid()::text,
 empleado_id text not null references empleados(id),
 tipo text not null check (tipo in ('permiso','incapacidad')),
 inicio date not null,
 fin date not null check (fin >= inicio),
 motivo text not null check (length(trim(motivo)) between 1 and 2000),
 descontar boolean not null,
 soporte text,
 soporte_nombre text,
 soporte_tipo text,
 creado_por text not null,
 creado_en timestamptz not null default now(),
 anulado_en timestamptz,
 anulado_por text,
 check (tipo <> 'incapacidad' or soporte is not null)
);
create index if not exists permisos_empleado_fechas on permisos (empleado_id, inicio, fin) where anulado_en is null;
