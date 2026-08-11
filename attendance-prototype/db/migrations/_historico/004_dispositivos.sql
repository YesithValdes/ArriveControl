-- 004_dispositivos.sql
-- Activación por DISPOSITIVO del kiosco: cada tablet/celular se activa UNA vez
-- (con sesión de admin) y recibe su propia clave. El servidor exige esa clave
-- en las APIs del kiosco (marcaciones y roster facial), así que un aparato
-- perdido se revoca sin afectar a los demás y nadie sin clave puede insertar
-- marcaciones ni descargar descriptores faciales.
--
-- La clave NUNCA se guarda en claro: solo su hash sha256 (hex). El valor real
-- se muestra una única vez al activar y vive en el localStorage del aparato.
create table if not exists asistencia.dispositivos (
  id           text primary key default gen_random_uuid()::text,
  nombre       text not null,                    -- "Tablet recepción Pasto"
  sede_id      text references asistencia.sedes(id) on delete set null,
  clave_hash   text not null unique,             -- sha256 hex de la clave
  activo       boolean not null default true,    -- false = revocado
  activado_por text,                             -- email del admin que activó
  creada_en    timestamptz not null default now(),
  ultimo_uso   timestamptz
);
create index if not exists dispositivos_activos on asistencia.dispositivos (clave_hash) where activo;
