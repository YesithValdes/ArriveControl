-- ============================================================================
-- ArriveControl · Estructura multitenant  ·  BORRADOR PARA REVISIÓN
--
-- Este archivo NO se ejecuta. Vive en docs/ a propósito, fuera de
-- db/migrations/, para que `node db/migrate.mjs` no lo toque. Cuando se
-- apruebe se parte en migraciones de verdad.
--
-- Fiel al DDL que hoy tiene el esquema `asistencia` (leído de la base, no de
-- las migraciones): mismos tipos, defaults, checks, únicos e índices.
--
-- ---------------------------------------------------------------------------
-- EL PRINCIPIO QUE DECIDE DÓNDE VA CADA TABLA
--
--   `control` guarda ÚNICAMENTE lo que hay que leer ANTES de saber de qué
--   empresa se trata. Todo lo demás pertenece a la empresa.
--
-- Eso deja en `control` solo el directorio: las empresas, la identidad de
-- quien entra (Better Auth) y los dispositivos del kiosco. Todo lo operativo
-- —sedes, empleados, marcaciones— vive en el esquema de su empresa.
--
-- Y ahí NINGUNA tabla lleva `empresa_id`: el esquema YA es la frontera. Una
-- fila de `t_kupocell.sedes` es de KUPOCELL por estar donde está, y no puede
-- aparecer en `t_acme` ni por error. Es la diferencia con una sola base
-- compartida, donde un `where` mal escrito mezcla dos clientes.
-- ============================================================================


-- ============================================================================
-- 1. ESQUEMA `control` — existe UNA sola vez
-- ============================================================================
create schema if not exists control;

-- ── Empresas (los inquilinos) ───────────────────────────────────────────
create table control.empresas (
  id          uuid primary key default gen_random_uuid(),

  -- Nombre del esquema donde viven sus datos. El check es de seguridad, no
  -- de estilo: este valor se interpola en `set search_path`, así que no
  -- puede aceptar cualquier texto.
  esquema     text not null unique
              check (esquema ~ '^[a-z][a-z0-9_]{2,40}$'),

  nombre      text not null,
  nit         text,

  -- Dominio de correo de la empresa. SUGERENCIA, no autorización: sirve para
  -- proponer correos al invitar o avisar «este no es de tu dominio». Quien
  -- autoriza es la invitación — media pyme usa Gmail y un dominio parecido
  -- (kupoce1l.com) sería una puerta de entrada.
  dominio     text,

  -- Clave que usa la nómina de ESA empresa en GET /api/horas. Antes era una
  -- sola variable de entorno para toda la instalación.
  api_key     text unique,

  creada_en   timestamptz not null default now(),

  -- ── Plan ──────────────────────────────────────────────────────────
  -- Registrarse es gratis y crea empresa de inmediato. Se paga al pasar
  -- del límite de empleados, no antes.
  plan        text not null default 'gratis'
              check (plan in ('gratis', 'pago')),

  -- Tope de empleados del plan gratuito. NULL = sin límite (plan de pago).
  -- Es una columna y no una constante para poder subírselo a un cliente
  -- puntual sin tocar código ni migrar nada.
  limite_empleados integer default 10 check (limite_empleados is null or limite_empleados > 0),

  -- Suscripción. Solo aplica a las empresas que pasaron a plan de pago; una
  -- empresa gratuita nunca vence. Campos neutros a propósito: la pasarela no
  -- está elegida y el resto del sistema no debe enterarse de cuál es.
  estado      text not null default 'activa'
              check (estado in ('activa', 'vencida', 'cancelada')),
  vence_en    timestamptz,
  pago_proveedor  text,   -- 'wompi' | 'stripe' | 'manual' | …
  pago_referencia text    -- id de la suscripción en esa pasarela
);

-- ── Identidad (Better Auth) ─────────────────────────────────────────────
-- Estas cuatro tablas se mueven tal cual desde `asistencia`. Better Auth las
-- busca sin prefijo de esquema, y su pool queda fijo en `search_path=control`.
create table control."user" (
  id             text primary key default gen_random_uuid()::text,
  name           text not null,
  email          text not null unique,
  email_verified boolean not null default false,
  image          text,

  -- A qué empresa pertenece. NULL = entró (p. ej. con Google) pero todavía
  -- no tiene empresa: no autoriza absolutamente nada. Es lo que permite
  -- abrir el registro sin abrir un hueco.
  empresa_id     uuid references control.empresas(id) on delete restrict,

  -- Qué puede hacer dentro de su empresa.
  rol            text not null default 'consulta'
                 check (rol in ('dueno', 'supervisor', 'consulta')),

  -- Límite de visibilidad del supervisor: la única sede que ve. NULL en los
  -- demás roles, que ven todas las de su empresa.
  --
  -- Texto SIN llave foránea, y no se puede evitar: apunta a una fila de
  -- `sedes` que está en el esquema de la empresa, y ese esquema cambia por
  -- fila. Una columna solo puede referenciar una tabla fija. Consecuencias a
  -- cubrir en código: al borrar una sede hay que limpiar los usuarios que la
  -- apuntaban (antes lo hacía `on delete set null`), y nada impide guardar
  -- aquí el id de una sede de otra empresa.
  sede_id        text,

  activo         boolean not null default true,

  -- Columnas del plugin `admin` de Better Auth.
  role           text default 'user',
  banned         boolean default false,
  ban_reason     text,
  ban_expires    timestamptz,

  ultimo_acceso  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index user_empresa_idx on control."user" (empresa_id);

create table control.session (
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
create index session_usuario_idx on control.session (user_id);

create table control.account (
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
create index account_usuario_idx on control.account (user_id);

create table control.verification (
  id         text primary key default gen_random_uuid()::text,
  identifier text not null,
  value      text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index verification_ident on control.verification (identifier);

-- ── Dispositivos del kiosco ─────────────────────────────────────────────
-- Viven aquí porque el kiosco NO tiene sesión: llega con X-Device-Key y hay
-- que averiguar a qué empresa pertenece antes de poder abrir su esquema.
--
-- La búsqueda por `clave_hash` funciona porque el hash es sha256, que es
-- determinista. Si algún día se cambia a bcrypt —que lleva sal por fila—
-- habría que recorrer los dispositivos de TODAS las empresas para encontrar
-- uno, y este diseño deja de servir.
create table control.dispositivos (
  id           text primary key default gen_random_uuid()::text,
  empresa_id   uuid not null references control.empresas(id) on delete cascade,
  nombre       text not null,
  clave_hash   text not null unique,
  -- Misma situación que `user.sede_id`: apunta al esquema de la empresa, así
  -- que va sin llave foránea y se valida en código.
  sede_id      text,
  activo       boolean not null default true,
  activado_por text,
  creada_en    timestamptz not null default now(),
  ultimo_uso   timestamptz
);
create index dispositivos_activos on control.dispositivos (clave_hash) where activo;
create index dispositivos_empresa_idx on control.dispositivos (empresa_id);

-- ── Invitaciones ────────────────────────────────────────────────────────
-- Cómo entra alguien a una empresa que YA existe. Vive en `control` porque
-- hay que consultarla ANTES de saber a qué empresa pertenece quien entra.
--
-- Es lo que autoriza, y no el dominio del correo: la mitad de las pymes usa
-- Gmail, un contador externo tiene su propio dominio, y un dominio parecido
-- se convertiría en una puerta.
create table control.invitaciones (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references control.empresas(id) on delete cascade,
  email        text not null,
  rol          text not null default 'consulta'
               check (rol in ('dueno', 'supervisor', 'consulta')),
  sede_id      text,   -- mismo caso que user.sede_id: sin FK
  invitado_por text,
  creada_en    timestamptz not null default now(),
  expira_en    timestamptz not null default now() + interval '14 days',
  aceptada_en  timestamptz
);

-- Un correo no puede tener DOS invitaciones pendientes a la vez, ni siquiera
-- de empresas distintas: si no, dos clientes invitan al mismo contador y cuál
-- gana lo decide el orden de llegada. El índice es PARCIAL: deja de estorbar
-- en cuanto la invitación se acepta, y el histórico queda para auditoría.
create unique index invitacion_pendiente_unica
  on control.invitaciones (lower(email)) where aceptada_en is null;

create index invitaciones_empresa_idx on control.invitaciones (empresa_id);

-- ── Registro de migraciones de `control` ───────────────────────────────────
create table control._migraciones (
  archivo     text primary key,
  aplicada_en timestamptz not null default now()
);


-- ============================================================================
-- 2. ESQUEMA DE EMPRESA — se repite por cada inquilino
--
-- Plantilla. Al crear una empresa se ejecuta esto dentro de su esquema, con
-- el search_path ya puesto, y por eso NINGUNA tabla lleva prefijo.
-- ============================================================================
-- create schema t_ejemplo;
-- set search_path to t_ejemplo;

-- ── Sedes ───────────────────────────────────────────────────────────────
create table sedes (
  id        text primary key default gen_random_uuid()::text,
  nombre    text not null unique,
  lat       double precision not null,
  lon       double precision not null,
  radio_m   integer not null default 50 check (radio_m > 0),
  creada_en timestamptz not null default now()
);

-- ── Empleados ───────────────────────────────────────────────────────────
create table empleados (
  id                text primary key default gen_random_uuid()::text,
  nombre            text not null,
  -- Único DENTRO de la empresa. Es una ventaja del esquema por inquilino:
  -- la misma persona puede trabajar en dos empresas clientes sin chocar.
  cedula            text unique,
  sede_id           text references sedes(id) on delete set null,
  entrada_esperada  time,
  salida_esperada   time,
  almuerzo_min      integer default 60 check (almuerzo_min >= 0),
  descriptor_facial real[],           -- 128 floats · DATO BIOMÉTRICO (Ley 1581)
  jornada_semanal   real[]            -- [lun..sáb] o NULL = jornada legal
                    check (jornada_semanal is null or (
                      array_length(jornada_semanal, 1) = 6
                      and 0 <= all(jornada_semanal)
                      and 12 >= all(jornada_semanal))),
  salario_mensual   numeric(14,2) check (salario_mensual is null or salario_mensual > 0),
  colaborador_id    uuid,             -- vínculo con el gestor externo, si lo hay
  activo            boolean not null default true,
  creado_en         timestamptz not null default now()
);
create unique index empleados_colaborador_unico
  on empleados (colaborador_id) where colaborador_id is not null;

-- ── Marcaciones ─────────────────────────────────────────────────────────
create table marcaciones (
  id             text primary key default gen_random_uuid()::text,
  empleado_id    text not null references empleados(id),
  tipo           text not null check (tipo in ('entrada', 'salida')),
  ts             timestamptz not null default now(),
  ts_dispositivo timestamptz,
  sede_id        text references sedes(id),
  origen         text not null default 'kiosco'
                 check (origen in ('kiosco', 'kiosco_diferido', 'manual')),
  eliminada      boolean not null default false,   -- baja lógica
  creada_en      timestamptz not null default now()
);
create index marcaciones_emp_ts on marcaciones (empleado_id, ts);
create index marcaciones_ts_activas on marcaciones (ts) where not eliminada;

-- ── Correcciones (auditoría) ────────────────────────────────────────────
create table correcciones (
  id             text primary key default gen_random_uuid()::text,
  marcacion_id   text references marcaciones(id),
  -- Quién la hizo. Texto sin llave foránea a propósito: si el usuario se
  -- borra, la auditoría no puede irse con él.
  admin_user_id  text not null,
  admin_email    text,
  accion         text not null
                 check (accion in ('crear', 'editar_hora', 'editar_tipo', 'eliminar')),
  valor_anterior jsonb,
  valor_nuevo    jsonb,
  motivo         text not null,
  ts             timestamptz not null default now()
);
create index correcciones_marcacion on correcciones (marcacion_id);

-- ── Intentos del kiosco (diagnóstico) ───────────────────────────────────
create table intentos_kiosco (
  id          text primary key default gen_random_uuid()::text,
  empleado_id text references empleados(id),
  aceptado    boolean not null,
  distancia   real,
  liveness_ok boolean,
  sede_id     text references sedes(id),
  ts          timestamptz not null default now()
);
create index intentos_ts on intentos_kiosco (ts);

-- ── Configuración laboral (fila única) ──────────────────────────────────
-- El `id boolean check (id)` es el truco de la fila única: solo cabe `true`,
-- así que es imposible tener dos configuraciones.
create table config_laboral (
  id                boolean primary key default true check (id),
  horas_semana      integer not null default 42 check (horas_semana between 1 and 84),
  horas_dia         integer not null default 7  check (horas_dia between 1 and 12),
  gracia_min        integer not null default 15 check (gracia_min >= 0),
  festivos          date[]  not null default '{}',
  divisor_horas_mes integer not null default 240 check (divisor_horas_mes between 1 and 744),
  factores_hora     jsonb   not null default
                    '{"HED": 1.25, "HEN": 1.75, "HEDDF": 2.15, "HENDF": 2.65}'::jsonb,
  nocturno_inicio   time not null default '21:00',
  nocturno_fin      time not null default '06:00'
);
insert into config_laboral (id) values (true);   -- toda empresa nace con una

-- ── Horas extra ya pagadas ──────────────────────────────────────────────
create table horas_pagadas (
  referencia_externa text primary key,   -- arrive-{cédula}-{fecha}-{ini}-{fin}-{código}
  documento          text not null,
  pagado_en          timestamptz not null default now(),
  pagado_por         text
);
create index horas_pagadas_documento_idx on horas_pagadas (documento);

-- ── Bitácora histórica de envíos a nómina (congelada) ───────────────────
-- Ya no se escribe: nómina consulta bajo demanda (GET /api/horas). Se
-- conserva por su historial. Una empresa nueva la crea vacía.
create table envios_rh (
  id                 text primary key default gen_random_uuid()::text,
  referencia_externa text not null unique,
  empleado_id        text not null references empleados(id),
  semana             date not null,
  payload            jsonb not null,
  estado             text not null default 'enviado'
                     check (estado in ('enviado', 'aplicado', 'duplicado', 'rechazado')),
  motivo_rechazo     text,
  enviado_por        text,
  ts                 timestamptz not null default now()
);
create index envios_semana on envios_rh (semana);

-- ── Registro de migraciones de ESTA empresa ─────────────────────────────
create table _migraciones (
  archivo     text primary key,
  aplicada_en timestamptz not null default now()
);


-- ============================================================================
-- 3. QUÉ CAMBIA RESPECTO DE HOY
-- ============================================================================
--
-- SE MUEVE a `control` (5 tablas, 4 filas en total hoy):
--   user, session, account, verification, dispositivos
--
-- SE QUEDA donde está — no se mueve ni un byte (1.776 filas):
--   sedes, empleados, marcaciones, correcciones, intentos_kiosco,
--   config_laboral, horas_pagadas, envios_rh, _migraciones
--
-- NACE:
--   control.empresas          ← el directorio de inquilinos
--   user.empresa_id           ← a qué empresa pertenece cada quien
--   dispositivos.empresa_id   ← de qué empresa es cada tablet
--
-- SE PIERDEN DOS LLAVES FORÁNEAS, y hay que reponerlas en código:
--   user.sede_id        → sedes
--   dispositivos.sede_id → sedes
--   Ambas quedan como texto suelto porque apuntan a un esquema que se
--   elige en tiempo de ejecución. Qué hay que cubrir a mano:
--     · al borrar una sede, limpiar quien la apuntaba (lo hacía ON DELETE
--       SET NULL);
--     · validar que la sede exista y sea de la MISMA empresa antes de
--       guardar — la base ya no lo va a rechazar.
--
-- OJO con TRUNCATE: hoy `TRUNCATE sedes CASCADE` vacía la tabla `user`
-- entera, porque TRUNCATE ignora el ON DELETE SET NULL. Al quedar sin FK
-- ese riesgo desaparece, pero conviene no usar TRUNCATE CASCADE nunca.
--
-- LO QUE EL MODELO REGALA:
--   `empleados.cedula` es único DENTRO de cada empresa, así que la misma
--   persona puede trabajar en dos empresas clientes sin chocar.
