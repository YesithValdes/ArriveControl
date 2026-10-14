-- Permite cancelar solo la integración por API sin suspender el panel o kiosco.
alter table control.empresas
  add column if not exists api_suspendida boolean not null default false;
