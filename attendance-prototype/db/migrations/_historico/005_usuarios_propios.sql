-- 005_usuarios_propios.sql
-- ArriveControl deja de preguntarle quién es quién al gestor de empleados:
-- tiene sus propios usuarios, sesiones y roles. Es el paso que lo vuelve un
-- producto independiente (antes cada petición leía public."user", rol y
-- rol_permiso, tablas del otro sistema).
--
-- Las tablas llevan los nombres que espera Better Auth (user, session,
-- account, verification) pero viven en el esquema `asistencia`; el pool de
-- la app usa search_path=asistencia,public, así que resuelven aquí primero.
--
-- ROLES (tres, a propósito: más roles estorban en una empresa de 30 personas)
--   dueno      → todo, incluida la gestión de usuarios
--   supervisor → ve y corrige SOLO su sede; no toca biometría ni configuración
--   consulta   → ve todo y exporta, pero no modifica nada (contador/nómina).
--                Separación de funciones: quien liquida no fabrica asistencia.

create table if not exists asistencia."user" (
  id             text primary key default gen_random_uuid()::text,
  name           text not null,
  email          text not null unique,
  email_verified boolean not null default false,
  image          text,
  -- Rol propio de ArriveControl (no el del gestor).
  rol            text not null default 'consulta'
                 check (rol in ('dueno', 'supervisor', 'consulta')),
  -- Alcance del supervisor: la sede que puede ver y corregir. NULL en los
  -- demás roles (que ven todas).
  sede_id        text references asistencia.sedes(id) on delete set null,
  activo         boolean not null default true,
  ultimo_acceso  timestamptz,
  -- Columnas del plugin `admin` de Better Auth (lo usamos para crear usuarios
  -- con contraseña desde el panel; el registro abierto está deshabilitado).
  role           text default 'user',
  banned         boolean default false,
  ban_reason     text,
  ban_expires    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists asistencia.session (
  id         text primary key default gen_random_uuid()::text,
  expires_at timestamptz not null,
  token      text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  user_id    text not null references asistencia."user"(id) on delete cascade,
  impersonated_by text
);
-- Ojo: `session_user` es palabra reservada de Postgres, de ahí el nombre largo.
create index if not exists session_usuario_idx on asistencia.session (user_id);

create table if not exists asistencia.account (
  id                        text primary key default gen_random_uuid()::text,
  account_id                text not null,
  provider_id               text not null,
  user_id                   text not null references asistencia."user"(id) on delete cascade,
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
create index if not exists account_usuario_idx on asistencia.account (user_id);

create table if not exists asistencia.verification (
  id         text primary key default gen_random_uuid()::text,
  identifier text not null,
  value      text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verification_ident on asistencia.verification (identifier);
