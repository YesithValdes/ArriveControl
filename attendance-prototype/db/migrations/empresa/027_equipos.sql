create table if not exists equipos (
  id text primary key default gen_random_uuid()::text,
  nombre text not null check (char_length(trim(nombre)) between 1 and 100),
  descripcion text not null default '' check (char_length(descripcion) <= 500),
  creado_en timestamptz not null default now()
);
create unique index if not exists equipos_nombre_unico on equipos (lower(nombre));
create table if not exists equipo_miembros (
  equipo_id text not null references equipos(id) on delete cascade,
  empleado_id text not null references empleados(id) on delete cascade,
  primary key (equipo_id, empleado_id)
);
create index if not exists equipo_miembros_empleado on equipo_miembros (empleado_id);
