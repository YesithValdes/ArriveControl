-- control/001_control.sql
-- El DIRECTORIO: existe una sola vez en toda la instalación.
--
-- Aquí vive únicamente lo que hay que leer ANTES de saber de qué empresa se
-- trata. Todo lo demás pertenece a la empresa y vive en su esquema
-- (ver empresa/001_base.sql).
--
-- Son tres cosas: quién es cliente, quién entra, y qué tablet marca.

create schema if not exists control;

-- ── Empresas (los inquilinos) ───────────────────────────────────────────
create table if not exists control.empresas (
  id          uuid primary key default gen_random_uuid(),

  -- Nombre del esquema donde viven sus datos. El check es de SEGURIDAD, no de
  -- estilo: este valor se interpola en `set search_path`, así que no puede
  -- aceptar texto arbitrario.
  esquema     text not null unique
              check (esquema ~ '^[a-z][a-z0-9_]{2,40}$'),

  nombre      text not null,
  nit         text,

  -- Dominio de correo de la empresa. SUGERENCIA, no autorización: sirve para
  -- proponer correos al invitar. Quien autoriza es la invitación — media pyme
  -- usa Gmail, y un dominio parecido sería una puerta de entrada.
  dominio     text,

  -- Clave que usa la nómina de ESA empresa en GET /api/horas. Antes era una
  -- sola variable de entorno para toda la instalación.
  api_key     text unique,

  creada_en   timestamptz not null default now(),

  -- ── Plan ──────────────────────────────────────────────────────────
  -- Registrarse es gratis y crea la empresa de inmediato. Se paga al pasar
  -- del tope de empleados, no antes.
  plan        text not null default 'gratis'
              check (plan in ('gratis', 'pago')),

  -- Tope de empleados del plan gratuito. NULL = sin límite (plan de pago).
  -- Columna y no constante para poder subírselo a un cliente puntual sin
  -- tocar código ni migrar nada.
  limite_empleados integer default 10
              check (limite_empleados is null or limite_empleados > 0),

  -- Suscripción. Solo aplica a quien pasó a plan de pago: una empresa
  -- gratuita nunca vence. Campos neutros a propósito — la pasarela no está
  -- elegida y el resto del sistema no debe enterarse de cuál es.
  estado      text not null default 'activa'
              check (estado in ('activa', 'vencida', 'cancelada')),
  vence_en    timestamptz,
  pago_proveedor  text,
  pago_referencia text
);

-- ── Identidad (Better Auth) ─────────────────────────────────────────────
-- Better Auth busca sus tablas SIN prefijo de esquema, y su pool queda fijo
-- en `search_path=control`. Por eso la identidad no puede vivir en el esquema
-- de la empresa: ese cambia en cada petición, y además haría falta saber la
-- empresa para poder leer al usuario que dice cuál es la empresa.
create table if not exists control."user" (
  id             text primary key default gen_random_uuid()::text,
  name           text not null,
  email          text not null unique,
  email_verified boolean not null default false,
  image          text,

  -- A qué empresa pertenece. NULL solo de forma transitoria: quien entra sale
  -- con empresa, propia o por invitación. Con NULL no autoriza nada.
  empresa_id     uuid references control.empresas(id) on delete restrict,

  -- Qué puede hacer dentro de su empresa.
  rol            text not null default 'consulta'
                 check (rol in ('dueno', 'supervisor', 'consulta')),

  -- Límite de visibilidad del supervisor: la única sede que ve. NULL en los
  -- demás roles, que ven todas las de su empresa.
  --
  -- Texto SIN llave foránea, y no se puede evitar: apunta a una fila de
  -- `sedes`, que vive en el esquema de la empresa, y ese esquema cambia por
  -- fila. Una llave foránea apunta a UNA tabla fija. Hay que cubrir en código:
  --   · al borrar una sede, limpiar los usuarios que la apuntaban
  --     (antes lo hacía `on delete set null`);
  --   · verificar que la sede sea de la MISMA empresa antes de guardar.
  sede_id        text,

  activo         boolean not null default true,
  ultimo_acceso  timestamptz,

  -- Columnas del plugin `admin` de Better Auth.
  role           text default 'user',
  banned         boolean default false,
  ban_reason     text,
  ban_expires    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists user_empresa_idx on control."user" (empresa_id);

create table if not exists control.session (
  id         text primary key default gen_random_uuid()::text,
  expires_at timestamptz not null,
  token      text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  user_id    text not null references control."user"(id) on delete cascade,
  impersonated_by text
);
-- Ojo: `session_user` es palabra reservada de Postgres, de ahí el nombre largo.
create index if not exists session_usuario_idx on control.session (user_id);

create table if not exists control.account (
  id                        text primary key default gen_random_uuid()::text,
  account_id                text not null,
  provider_id               text not null,   -- 'credential' | 'google' | …
  user_id                   text not null references control."user"(id) on delete cascade,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists account_usuario_idx on control.account (user_id);

create table if not exists control.verification (
  id         text primary key default gen_random_uuid()::text,
  identifier text not null,
  value      text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verification_ident on control.verification (identifier);

-- ── Invitaciones ────────────────────────────────────────────────────────
-- Cómo entra alguien a una empresa que YA existe. Vive aquí porque hay que
-- consultarla ANTES de saber a qué empresa pertenece quien está entrando.
--
-- Es lo que autoriza, y no el dominio del correo: media pyme usa Gmail, un
-- contador externo tiene su propio dominio, y un dominio parecido
-- (kupoce1l.com) se convertiría en una puerta.
--
-- ORDEN CRÍTICO en el primer ingreso: primero se busca la invitación, y solo
-- si no hay se crea empresa. Al revés, quien fue invitado por su jefe termina
-- con una empresa propia y vacía en lugar de entrar a la de él.
create table if not exists control.invitaciones (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references control.empresas(id) on delete cascade,
  email        text not null,
  rol          text not null default 'consulta'
               check (rol in ('dueno', 'supervisor', 'consulta')),
  sede_id      text,   -- mismo caso que user.sede_id: sin llave foránea
  invitado_por text,
  creada_en    timestamptz not null default now(),
  expira_en    timestamptz not null default now() + interval '14 days',
  aceptada_en  timestamptz
);

-- Un correo no puede tener DOS invitaciones pendientes a la vez, ni siquiera
-- de empresas distintas: si no, dos clientes invitan al mismo contador y cuál
-- gana lo decide el orden de llegada. El índice es PARCIAL — deja de estorbar
-- en cuanto se acepta, y el histórico queda para auditoría.
create unique index if not exists invitacion_pendiente_unica
  on control.invitaciones (lower(email)) where aceptada_en is null;
create index if not exists invitaciones_empresa_idx on control.invitaciones (empresa_id);

-- ── Dispositivos del kiosco ─────────────────────────────────────────────
-- Viven aquí porque el kiosco NO tiene sesión: llega con X-Device-Key y hay
-- que averiguar de qué empresa es antes de poder abrir su esquema.
--
-- La búsqueda por `clave_hash` funciona porque el hash es sha256, que es
-- determinista. Si algún día se cambia a bcrypt —que lleva sal por fila—
-- habría que recorrer los dispositivos de TODAS las empresas, y este diseño
-- deja de servir.
create table if not exists control.dispositivos (
  id           text primary key default gen_random_uuid()::text,
  empresa_id   uuid not null references control.empresas(id) on delete cascade,
  nombre       text not null,
  clave_hash   text not null unique,
  sede_id      text,   -- mismo caso que user.sede_id: sin llave foránea
  activo       boolean not null default true,
  activado_por text,
  creada_en    timestamptz not null default now(),
  ultimo_uso   timestamptz
);
create index if not exists dispositivos_activos on control.dispositivos (clave_hash) where activo;
create index if not exists dispositivos_empresa_idx on control.dispositivos (empresa_id);
