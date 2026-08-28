-- control/006_prueba.sql — Prueba gratuita de 30 días.
--
-- El modelo comercial es: 30 días con el producto COMPLETO (sin tope de
-- empleados) y, al vencer, la empresa cae al plan gratuito de 10 en vez de
-- quedarse sin servicio. Quien ya tiene más de 10 empleados los conserva
-- marcando; solo deja de poder agregar más hasta que pase a plan de pago.
--
-- Se guarda la FECHA en que termina, no un booleano ni los días restantes:
-- es el único dato que no se desactualiza solo.
--
-- NULL = sin prueba. Las empresas que ya existían cuando se agregó esta
-- columna no reciben una prueba retroactiva: siguen exactamente como estaban.
-- El superadmin puede otorgarla a mano poniendo una fecha.
alter table control.empresas
  add column if not exists prueba_hasta timestamptz;
