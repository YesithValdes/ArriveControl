-- control/011_bienvenida.sql — La pantalla de suscripción del primer acceso.
--
-- Antes de entrar al panel por primera vez se ofrece pagar de una: quien ya
-- decidió no tiene por qué gastar sus días de prueba para poder suscribirse.
-- Es opcional — se puede omitir y seguir con la prueba.
--
-- Se guarda CUÁNDO se resolvió (pagando u omitiendo) y no un booleano: la
-- fecha responde además «hace cuánto», que sirve para saber si la pantalla
-- está cumpliendo su función.
alter table control.empresas
  add column if not exists bienvenida_en timestamptz;

-- Las empresas que ya existen nunca la vieron y no tiene sentido mostrársela
-- ahora: llevan tiempo usando el sistema. Se marca como resuelta.
update control.empresas set bienvenida_en = coalesce(bienvenida_en, now());
