-- Cobro de la suscripción con MERCADO PAGO (débito automático mensual).
-- Reemplaza a Bold; el historial de pagos de Bold se conserva tal cual.
-- Lógica en lib/suscripciones.js; integración en lib/mercadopago.js.

-- Una suscripción (preapproval de Mercado Pago) por empresa. Los precios se
-- fijan en DÓLARES (lib/planes.js) y se cobran en PESOS con la TRM.
create table if not exists control.suscripciones (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references control.empresas(id) on delete cascade,
  proveedor         text not null default 'mercadopago' check (proveedor = 'mercadopago'),
  mp_id             text unique,                 -- id del preapproval en Mercado Pago
  estado            text not null default 'creando'
                    check (estado in ('creando', 'pendiente', 'autorizada', 'pausada', 'cancelada')),
  plan_id           text not null,
  usd_mensual       numeric(10, 2) not null check (usd_mensual > 0),
  -- Oferta de entrada: el PRIMER cobro va a este precio; luego se pasa al normal.
  usd_entrada       numeric(10, 2) check (usd_entrada > 0),
  entrada_pendiente boolean not null default false,
  -- El monto en pesos quedó desactualizado (fin de la entrada o TRM) y el
  -- cambio en Mercado Pago aún no se confirmó: el cron lo reintenta.
  ajuste_pendiente  boolean not null default false,
  monto_cop         integer not null check (monto_cop > 0),
  trm               numeric(10, 2) not null check (trm > 0),
  payer_email       text not null,
  init_point        text,
  proximo_cobro     timestamptz,
  creada_por        text,
  creada_en         timestamptz not null default now(),
  actualizada_en    timestamptz not null default now(),
  cancelada_en      timestamptz
);
-- Como máximo UNA suscripción viva por empresa: impide dos cobros paralelos y
-- que la oferta de entrada se use más de una vez a la vez.
create unique index if not exists suscripciones_una_viva
  on control.suscripciones (empresa_id)
  where estado in ('creando', 'pendiente', 'autorizada', 'pausada');
create index if not exists suscripciones_empresa on control.suscripciones (empresa_id, creada_en desc);

-- TRM oficial (Superintendencia Financiera, datos.gov.co), una por día.
create table if not exists control.trm (
  fecha       date primary key,
  valor       numeric(10, 2) not null check (valor > 0),
  obtenida_en timestamptz not null default now()
);

-- Cada aviso recibido de Mercado Pago (ya verificado por firma): bitácora para
-- revisar qué llegó y qué se hizo. Sin datos de tarjeta ni del pagador.
create table if not exists control.mp_avisos (
  id         bigserial primary key,
  tipo       text not null,
  recurso_id text not null,
  recibido_en timestamptz not null default now(),
  resultado  text,
  error      text
);
create index if not exists mp_avisos_recibido on control.mp_avisos (recibido_en desc);

-- Idempotencia de los cobros: control.pagos.transaccion ya es UNIQUE (007).
-- Cada cobro de Mercado Pago se guarda con transaccion = 'mp:<id>', así que un
-- aviso repetido no puede registrarlo (ni extender la suscripción) dos veces.
