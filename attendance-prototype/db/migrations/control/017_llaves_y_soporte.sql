-- control/017_llaves_y_soporte.sql — Llaves de cifrado por empresa y acceso
-- de soporte autorizado.
--
-- La arquitectura (decidida, no se cambia sin explicarlo antes):
--
--   · Cada empresa tiene una DEK de 256 bits que cifra sus datos sensibles.
--   · La DEK NUNCA se guarda en claro. Se guarda ENVUELTA dos veces:
--       – con la llave MAESTRA del servidor (variable ARRIVE_LLAVE_MAESTRA),
--         que es la que usa la aplicación en el día a día;
--       – con la llave de RECUPERACIÓN de la empresa, que solo conoce el
--         dueño. Sirve para recuperar la DEK si la maestra se pierde o se
--         rota, y es la prueba de que los datos son de la empresa.
--   · El superadmin no tiene acceso permanente a los datos: solo entra cuando
--     la empresa lo AUTORIZA, por 72 horas como máximo, y cada acceso queda
--     registrado.
--
-- Las tres tablas viven en `control` porque hay que leerlas antes de abrir
-- el esquema de la empresa (y el soporte, por definición, no es de la
-- empresa).

-- ── Llaves de cada empresa ──────────────────────────────────────────────
create table if not exists control.empresa_llaves (
  empresa_id   uuid not null references control.empresas(id) on delete cascade,
  -- Versión de la DEK. Rotar la DEK es agregar la versión siguiente y
  -- retirar la anterior; los datos cifrados dicen con qué versión se
  -- cifraron, así que conviven mientras se re-cifran.
  version      integer not null default 1 check (version > 0),

  -- DEK envuelta con la llave maestra (AES-256-GCM, formato de lib/cifrado.js)
  -- y el identificador de qué maestra la envolvió, para poder rotarla.
  dek_maestra  text not null,
  maestra_id   text not null,

  -- DEK envuelta con la llave de recuperación de la empresa. NULL mientras el
  -- dueño no la genere: se le entrega UNA sola vez, en pantalla, y aquí solo
  -- queda la DEK envuelta y una huella para reconocerla cuando la escriba.
  dek_recuperacion        text,
  recuperacion_huella     text,
  recuperacion_creada_en  timestamptz,
  recuperacion_creada_por text,

  estado       text not null default 'activa' check (estado in ('activa', 'retirada')),
  creada_en    timestamptz not null default now(),

  primary key (empresa_id, version),

  -- O las dos cosas o ninguna: una DEK envuelta sin huella no se podría
  -- verificar, y una huella sin DEK no recupera nada.
  constraint empresa_llaves_recuperacion_completa
    check ((dek_recuperacion is null) = (recuperacion_huella is null))
);

-- Una sola DEK ACTIVA por empresa: con dos, cuál cifra lo decidiría el azar.
-- Al borrar la empresa, `on delete cascade` borra sus llaves — y sin la DEK
-- lo que quede cifrado en cualquier respaldo es ilegible (borrado criptográfico).
create unique index if not exists empresa_llaves_una_activa
  on control.empresa_llaves (empresa_id) where estado = 'activa';

-- ── Autorizaciones de soporte ───────────────────────────────────────────
-- La empresa (su dueño) autoriza al soporte de la plataforma a entrar a SU
-- panel, en modo solo lectura, durante una ventana de máximo 72 horas.
--
-- SIN llave foránea a control.empresas, a propósito: es AUDITORÍA. Si la
-- empresa se elimina, el rastro de quién autorizó qué y cuándo debe quedar.
create table if not exists control.soporte_autorizaciones (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null,
  -- control."user".id y correo de quien autorizó (el dueño), en texto: si el
  -- usuario se borra, la autorización sigue diciendo quién la dio.
  autorizada_por       text not null,
  autorizada_por_email text,
  motivo               text not null check (length(trim(motivo)) >= 5),
  desde                timestamptz not null default now(),
  hasta                timestamptz not null,
  revocada_en          timestamptz,
  revocada_por         text,
  creada_en            timestamptz not null default now(),

  constraint soporte_ventana_valida check (hasta > desde),
  -- El tope de 72 horas lo impone la BASE, no solo la pantalla: ni un error
  -- de código ni una petición armada a mano pueden dar más.
  constraint soporte_maximo_72h check (hasta <= desde + interval '72 hours')
);
create index if not exists soporte_autorizaciones_empresa_idx
  on control.soporte_autorizaciones (empresa_id, hasta desc);

-- ── Accesos del soporte (bitácora) ──────────────────────────────────────
-- Cada vez que el soporte entra, consulta algo, intenta algo que no puede o
-- sale, queda una fila. Es lo que la empresa revisa para saber qué se miró.
-- Sin llaves foráneas por la misma razón que arriba.
create table if not exists control.soporte_accesos (
  id              bigserial primary key,
  autorizacion_id uuid not null,
  empresa_id      uuid not null,
  usuario_id      text not null,   -- el superadmin que entró
  usuario_email   text,
  -- entrar | salir | ver (consulta permitida) | denegado (intentó escribir o
  -- algo que el soporte no puede)
  accion          text not null check (accion in ('entrar', 'salir', 'ver', 'denegado')),
  metodo          text,
  ruta            text,
  detalle         text,
  ip              text,
  user_agent      text,
  ts              timestamptz not null default now()
);
create index if not exists soporte_accesos_empresa_idx
  on control.soporte_accesos (empresa_id, ts desc);
create index if not exists soporte_accesos_autorizacion_idx
  on control.soporte_accesos (autorizacion_id, ts desc);

-- ── La auditoría no se reescribe ────────────────────────────────────────
-- La bitácora solo crece: ni la aplicación ni un error pueden editarla o
-- borrarla. (Un dueño de la base con permisos de superusuario podría
-- desactivar el trigger; eso ya no es un descuido sino una decisión, y deja
-- su propio rastro en los registros de Postgres.)
create or replace function control.soporte_solo_agregar()
returns trigger language plpgsql as $$
begin
  raise exception 'control.%: la bitácora de soporte no se modifica ni se borra', tg_table_name;
end $$;

drop trigger if exists soporte_accesos_inmutable on control.soporte_accesos;
create trigger soporte_accesos_inmutable
  before update or delete on control.soporte_accesos
  for each row execute function control.soporte_solo_agregar();

-- De una autorización solo se puede cambiar una cosa, una vez: revocarla.
-- Lo demás (quién, por qué, la ventana) queda como se firmó.
create or replace function control.soporte_autorizacion_solo_revocar()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'control.soporte_autorizaciones: una autorización no se borra; se revoca';
  end if;
  if old.revocada_en is not null then
    raise exception 'control.soporte_autorizaciones: la autorización ya estaba revocada';
  end if;
  if new.revocada_en is null
     or (new.id, new.empresa_id, new.autorizada_por, new.autorizada_por_email,
         new.motivo, new.desde, new.hasta, new.creada_en)
        is distinct from
        (old.id, old.empresa_id, old.autorizada_por, old.autorizada_por_email,
         old.motivo, old.desde, old.hasta, old.creada_en) then
    raise exception 'control.soporte_autorizaciones: solo se permite revocar';
  end if;
  return new;
end $$;

drop trigger if exists soporte_autorizaciones_inmutable on control.soporte_autorizaciones;
create trigger soporte_autorizaciones_inmutable
  before update or delete on control.soporte_autorizaciones
  for each row execute function control.soporte_autorizacion_solo_revocar();
