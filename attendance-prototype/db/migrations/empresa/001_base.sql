-- empresa/001_base.sql
-- Acta de nacimiento de una empresa: todo lo operativo de un cliente.
--
-- NINGUNA tabla lleva prefijo de esquema. Se ejecuta con el `search_path` ya
-- puesto en el esquema de la empresa, y esa es también la regla que siguen las
-- consultas de la aplicación.
--
-- NINGUNA tabla lleva `empresa_id`: el esquema YA es la frontera. Una fila de
-- `t_kupocell.sedes` es de KUPOCELL por estar donde está, y no puede aparecer
-- en `t_acme` ni por error.
--
-- Todo va con `if not exists` a propósito: así correr esta plantilla sobre el
-- esquema `asistencia`, que ya existe desde antes del multitenant, es
-- inofensivo — se limita a registrarse como aplicada.
--
-- La identidad (user, session, account, verification) y los dispositivos del
-- kiosco NO están aquí: viven en `control`, porque hay que leerlos antes de
-- saber de qué empresa se trata. Ver control/001_control.sql.

-- ── Sedes ───────────────────────────────────────────────────────────────
create table if not exists sedes (
  id        text primary key default gen_random_uuid()::text,
  nombre    text not null unique,
  lat       double precision not null,
  lon       double precision not null,
  radio_m   integer not null default 50 check (radio_m > 0),
  creada_en timestamptz not null default now()
);

-- ── Empleados ───────────────────────────────────────────────────────────
-- Marcan con la cara y NO tienen cuenta de usuario. No confundir con quienes
-- entran al panel, que viven en control."user".
create table if not exists empleados (
  id                text primary key default gen_random_uuid()::text,
  nombre            text not null,
  -- Único DENTRO de la empresa. Es una ventaja del esquema por inquilino: la
  -- misma persona puede trabajar en dos empresas clientes sin chocar.
  cedula            text unique,
  sede_id           text references sedes(id) on delete set null,
  entrada_esperada  time,
  salida_esperada   time,
  almuerzo_min      integer default 60 check (almuerzo_min >= 0),
  -- 128 floats. DATO BIOMÉTRICO (Ley 1581): nunca sale de aquí salvo al
  -- kiosco, y la foto original jamás se guarda.
  descriptor_facial real[],
  -- Jornada distribuida [lun..sáb] (Ley 2101), o NULL = la legal vigente.
  jornada_semanal   real[]
                    check (jornada_semanal is null or (
                      array_length(jornada_semanal, 1) = 6
                      and 0 <= all(jornada_semanal)
                      and 12 >= all(jornada_semanal))),
  -- Opcional: sin salario las horas se cuentan igual, solo que no se valorizan.
  salario_mensual   numeric(14,2) check (salario_mensual is null or salario_mensual > 0),
  activo            boolean not null default true,
  creado_en         timestamptz not null default now()
);
-- ── Marcaciones ─────────────────────────────────────────────────────────
create table if not exists marcaciones (
  id             text primary key default gen_random_uuid()::text,
  empleado_id    text not null references empleados(id),
  tipo           text not null check (tipo in ('entrada', 'salida')),
  ts             timestamptz not null default now(),
  -- Hora que reportó el aparato en un envío diferido. La oficial es `ts`.
  ts_dispositivo timestamptz,
  sede_id        text references sedes(id),
  origen         text not null default 'kiosco'
                 check (origen in ('kiosco', 'kiosco_diferido', 'manual')),
  -- Baja LÓGICA: una marcación se paga, así que nunca se borra de verdad.
  eliminada      boolean not null default false,
  creada_en      timestamptz not null default now()
);
create index if not exists marcaciones_emp_ts on marcaciones (empleado_id, ts);
create index if not exists marcaciones_ts_activas on marcaciones (ts) where not eliminada;

-- ── Correcciones (auditoría) ────────────────────────────────────────────
-- Una marcación editada se convierte en horas extra pagadas, así que cada
-- cambio queda registrado con su motivo obligatorio.
create table if not exists correcciones (
  id             text primary key default gen_random_uuid()::text,
  marcacion_id   text references marcaciones(id),
  -- control."user".id. Texto sin llave foránea a propósito: si el usuario se
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
create index if not exists correcciones_marcacion on correcciones (marcacion_id);

-- ── Intentos del kiosco (diagnóstico) ───────────────────────────────────
-- Incluye los RECHAZADOS: son los que explican por qué alguien no pudo marcar.
create table if not exists intentos_kiosco (
  id          text primary key default gen_random_uuid()::text,
  empleado_id text references empleados(id),
  aceptado    boolean not null,
  distancia   real,
  liveness_ok boolean,
  sede_id     text references sedes(id),
  ts          timestamptz not null default now()
);
create index if not exists intentos_ts on intentos_kiosco (ts);

-- ── Configuración laboral (fila única) ──────────────────────────────────
-- El `id boolean check (id)` es el truco de la fila única: solo cabe `true`,
-- así que es imposible tener dos configuraciones y no hay que preguntarse
-- nunca cuál de las dos manda.
create table if not exists config_laboral (
  id                boolean primary key default true check (id),
  horas_semana      integer not null default 42 check (horas_semana between 1 and 84),
  horas_dia         integer not null default 7  check (horas_dia between 1 and 12),
  gracia_min        integer not null default 15 check (gracia_min >= 0),
  -- Solo los festivos EXTRA de la empresa: el calendario oficial de Colombia
  -- se calcula solo (Ley 51 de 1983, traslado Emiliani).
  festivos          date[]  not null default '{}',
  divisor_horas_mes integer not null default 240 check (divisor_horas_mes between 1 and 744),
  -- Factor TOTAL sobre la hora ordinaria (1.25 ya incluye la hora), editable
  -- desde Ajustes → Valorización de horas extra.
  factores_hora     jsonb   not null default
                    '{"HED": 1.25, "HEN": 1.75, "HEDDF": 2.15, "HENDF": 2.65}'::jsonb,
  nocturno_inicio   time not null default '21:00',
  nocturno_fin      time not null default '06:00'
);
-- Toda empresa nace con su configuración. `on conflict` porque en el esquema
-- que ya existía la fila está puesta desde hace rato.
insert into config_laboral (id) values (true) on conflict (id) do nothing;

-- ── Horas extra ya pagadas ──────────────────────────────────────────────
-- Anotación de lo liquidado en nómina, para no pagar dos veces. ArriveControl
-- no mueve dinero: esto no es un comprobante de pago.
create table if not exists horas_pagadas (
  -- arrive-{cédula}-{fecha}-{inicio}-{fin}-{código}: estable entre recálculos.
  referencia_externa text primary key,
  documento          text not null,
  pagado_en          timestamptz not null default now(),
  pagado_por         text
);
create index if not exists horas_pagadas_documento_idx on horas_pagadas (documento);

