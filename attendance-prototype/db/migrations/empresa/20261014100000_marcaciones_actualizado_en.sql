-- Cuándo cambió por última vez cada marcación (creada, corregida, geocodificada
-- o eliminada lógicamente). El panel la usa para pedir SOLO lo que cambió desde
-- su última sincronización (?cambiosDesde=...) en vez de descargar meses de
-- marcaciones en cada refresco — eso fue lo que agotó el egress gratuito de
-- Supabase (13,7 GB de 5 GB/mes).
--
-- `now()` es STABLE (no VOLATILE): Postgres evalúa el default UNA vez al
-- correr este ALTER y lo guarda como metadato, sin reescribir la tabla entera.
alter table marcaciones
  add column if not exists actualizado_en timestamptz not null default now();

-- Dispara en CUALQUIER UPDATE (corrección de hora/tipo, geocodificación,
-- adjuntar GPS tardío, borrado lógico): una sola fuente de verdad, para no
-- depender de que cada endpoint que escribe la tabla se acuerde de tocarla.
create or replace function _marcaciones_tocar_actualizado() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists marcaciones_actualizado_en on marcaciones;
create trigger marcaciones_actualizado_en
  before update on marcaciones
  for each row execute function _marcaciones_tocar_actualizado();

create index if not exists marcaciones_actualizado_en_idx on marcaciones (actualizado_en);
