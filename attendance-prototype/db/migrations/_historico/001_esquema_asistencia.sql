-- 001_esquema_asistencia.sql
-- Esquema propio `asistencia` en la MISMA base del gestor de Gestión Humana.
-- Separado de `public` para no chocar con las tablas de Prisma del gestor.
--
-- Decisiones:
--  * PK text con DEFAULT gen_random_uuid()::text — acepta uuid en producción
--    y los ids legibles del seed demo (E001, S1…) en desarrollo.
--  * `marcaciones.ts` lo pone SIEMPRE el servidor (default now()); la hora del
--    dispositivo solo se acepta como referencia en la cola offline.
--  * Nada se borra: `eliminada` es soft-delete y `correcciones` guarda el
--    antes/después de cada ajuste con su motivo.
--  * `correcciones.admin_user_id` referencia lógica al usuario del gestor
--    (tabla "user" de Better Auth en public); sin FK física para no acoplar
--    los esquemas — la sesión ya garantiza que el usuario existe.

create schema if not exists asistencia;

-- ── Sedes ────────────────────────────────────────────────────────────
create table if not exists asistencia.sedes (
  id         text primary key default gen_random_uuid()::text,
  nombre     text not null unique,
  lat        double precision not null,
  lon        double precision not null,
  radio_m    integer not null default 50 check (radio_m > 0),
  creada_en  timestamptz not null default now()
);

-- ── Empleados ────────────────────────────────────────────────────────
create table if not exists asistencia.empleados (
  id                text primary key default gen_random_uuid()::text,
  nombre            text not null,
  cedula            text unique,          -- normalizada, sin puntos
  sede_id           text references asistencia.sedes(id) on delete set null,
  entrada_esperada  time,                 -- null = horario libre
  salida_esperada   time,
  almuerzo_min      integer default 60 check (almuerzo_min >= 0),
  descriptor_facial real[],               -- vector 128 de face-api (nunca la foto)
  activo            boolean not null default true,
  creado_en         timestamptz not null default now()
);

-- ── Marcaciones (la única fuente de verdad de la asistencia) ─────────
create table if not exists asistencia.marcaciones (
  id             text primary key default gen_random_uuid()::text,
  empleado_id    text not null references asistencia.empleados(id),
  tipo           text not null check (tipo in ('entrada','salida')),
  ts             timestamptz not null default now(),   -- hora del SERVIDOR
  ts_dispositivo timestamptz,                          -- solo cola offline
  sede_id        text references asistencia.sedes(id),
  origen         text not null default 'kiosco'
                 check (origen in ('kiosco','kiosco_diferido','manual')),
  eliminada      boolean not null default false,
  creada_en      timestamptz not null default now()
);
create index if not exists marcaciones_emp_ts on asistencia.marcaciones (empleado_id, ts);
create index if not exists marcaciones_ts_activas on asistencia.marcaciones (ts) where not eliminada;

-- ── Auditoría de correcciones del admin ──────────────────────────────
create table if not exists asistencia.correcciones (
  id             text primary key default gen_random_uuid()::text,
  marcacion_id   text references asistencia.marcaciones(id),  -- null si fue alta manual
  admin_user_id  text not null,          -- id del usuario del gestor (Better Auth)
  admin_email    text,                   -- redundancia legible para reportes
  accion         text not null check (accion in ('crear','editar_hora','editar_tipo','eliminar')),
  valor_anterior jsonb,
  valor_nuevo    jsonb,
  motivo         text not null,
  ts             timestamptz not null default now()
);
create index if not exists correcciones_marcacion on asistencia.correcciones (marcacion_id);

-- ── Configuración laboral (fila única) ───────────────────────────────
create table if not exists asistencia.config_laboral (
  id            boolean primary key default true check (id),
  horas_semana  integer not null default 42 check (horas_semana between 1 and 84),
  gracia_min    integer not null default 15 check (gracia_min >= 0),
  festivos      date[] not null default '{}'
);
insert into asistencia.config_laboral (id) values (true) on conflict (id) do nothing;

-- ── Intentos del kiosco (métricas FAR/FRR y suplantación) ────────────
create table if not exists asistencia.intentos_kiosco (
  id          text primary key default gen_random_uuid()::text,
  empleado_id text references asistencia.empleados(id),  -- null si nadie coincidió
  aceptado    boolean not null,
  distancia   real,
  liveness_ok boolean,
  sede_id     text references asistencia.sedes(id),
  ts          timestamptz not null default now()
);
create index if not exists intentos_ts on asistencia.intentos_kiosco (ts);

-- ── Bitácora de envíos al gestor RH (idempotencia + rechazos) ────────
create table if not exists asistencia.envios_rh (
  id                 text primary key default gen_random_uuid()::text,
  referencia_externa text not null unique,
  empleado_id        text not null references asistencia.empleados(id),
  semana             date not null,               -- lunes de la semana enviada
  payload            jsonb not null,              -- el tramo tal como viajó
  estado             text not null default 'enviado'
                     check (estado in ('enviado','aplicado','duplicado','rechazado')),
  motivo_rechazo     text,
  enviado_por        text,                        -- email del usuario que envió
  ts                 timestamptz not null default now()
);
create index if not exists envios_semana on asistencia.envios_rh (semana);
