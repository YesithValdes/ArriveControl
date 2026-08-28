-- control/007_pagos.sql — Pagos de la suscripción.
--
-- El plan gratuito baja de 10 a 5 empleados: casi cualquier negocio con
-- personal pasa de cinco, así que el gratis sirve para conocer el producto y
-- la conversión ocurre cuando de verdad hay operación que controlar.
--
-- Solo cambia el valor POR DEFECTO, para las empresas que se registren de
-- ahora en adelante. A las que ya existen no se les recorta lo que ya tenían:
-- reducir un límite concedido es la clase de sorpresa que hace perder a un
-- cliente, y además el número vive en su propia columna justamente para poder
-- respetar acuerdos individuales.
alter table control.empresas
  alter column limite_empleados set default 5;

-- Cada intento de pago, con su desenlace.
--
-- Existe sobre todo por IDEMPOTENCIA: Wompi reintenta un evento hasta tres
-- veces en 24 horas si no recibe un 200, y sin esta tabla el mismo pago
-- extendería la suscripción varias veces. La restricción única sobre la
-- transacción es la que lo impide, no un `if` en el código.
create table if not exists control.pagos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references control.empresas(id) on delete cascade,

  -- La referencia que viaja al checkout. La generamos nosotros y por eso
  -- podemos reconocerla de vuelta.
  referencia    text not null unique,

  -- Id de la transacción en Wompi. NULL mientras el pago no se resuelve;
  -- único cuando llega, que es lo que hace idempotente al webhook.
  transaccion   text unique,

  proveedor     text not null default 'wompi',
  monto_centavos integer not null check (monto_centavos > 0),
  moneda        text not null default 'COP',

  -- APROBADA / RECHAZADA / ANULADA / ERROR, tal como las nombra la pasarela,
  -- más PENDIENTE mientras la persona está en el checkout.
  estado        text not null default 'PENDIENTE',

  -- Hasta cuándo quedó pagada la suscripción con este pago. Deja auditar por
  -- qué una empresa vence cuando vence, sin reconstruirlo de memoria.
  cubre_hasta   timestamptz,

  -- El evento completo, para poder investigar una discrepancia con soporte
  -- de la pasarela meses después.
  evento        jsonb,

  creado_en     timestamptz not null default now(),
  resuelto_en   timestamptz
);

create index if not exists pagos_empresa_idx on control.pagos (empresa_id, creado_en desc);
