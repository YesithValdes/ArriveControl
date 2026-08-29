-- control/009_planes_usd.sql — Modelo de cobro: oferta de entrada y mensual.
--
-- Cambia el modelo comercial: desaparecen la prueba gratuita de 30 días y el
-- plan gratuito de 5 empleados. Ahora usar el sistema exige una suscripción
-- vigente, y la puerta de entrada es un paquete barato de una sola vez
-- (1, 2 o 3 meses por 1, 2 o 3 dólares) antes del precio normal.

-- Qué se compró en cada pago. `meses` es lo que decide hasta cuándo queda
-- cubierta la suscripción, y se guarda en el pago —no se recalcula después—
-- para que un cambio de precios no altere lo que alguien ya compró.
alter table control.pagos
  add column if not exists meses   integer not null default 1 check (meses > 0),
  add column if not exists plan_id text;

-- La moneda pasa a dólares: Bold convierte a pesos con la TRM del momento y
-- el comercio recibe en COP.
alter table control.pagos alter column moneda set default 'USD';

-- ── Las empresas que YA existen no se quedan afuera ──────────────────────
--
-- Endurecer el acceso es correcto para quien llegue de ahora en adelante,
-- pero aplicarlo hacia atrás dejaría sin marcar a gente que hoy está
-- trabajando: la de SMARTGADGETS tiene doce empleados fichando a diario.
-- Quitarle el servicio a un cliente por un cambio de modelo interno sería la
-- peor forma de estrenar el cobro.
--
-- Se les reconoce un año de suscripción. Es una decisión de negocio, no
-- técnica: revísala y ajústala desde la consola de plataforma si alguna debe
-- pagar antes.
update control.empresas
   set plan = 'pago',
       estado = 'activa',
       limite_empleados = null,
       vence_en = greatest(coalesce(vence_en, now()), now() + interval '365 days')
 where true;
