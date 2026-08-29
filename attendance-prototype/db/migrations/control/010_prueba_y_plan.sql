-- control/010_prueba_y_plan.sql — Prueba de 3 días y plan por tamaño.
--
-- El recorrido pasa a ser el de un SaaS normal: se entra con una prueba corta
-- para ver el producto por dentro, y para seguir usándolo hay que suscribirse
-- a un plan, que depende de cuánta gente registre la empresa.

-- Hasta cuándo puede usar el sistema sin haber pagado. Se guarda la FECHA y no
-- los días restantes: es el único dato que no se desactualiza solo.
alter table control.empresas
  add column if not exists prueba_hasta timestamptz;

-- Qué plan tiene contratado ('esencial', 'equipo', 'empresa'). NULL mientras
-- no haya pagado ninguno. El tope de empleados sale del plan, no de aquí:
-- `limite_empleados` se conserva solo para acuerdos puntuales que se salgan
-- del catálogo.
alter table control.empresas
  add column if not exists plan_id text;

-- El pago guarda a qué plan corresponde, para poder auditar por qué una
-- empresa quedó con el tope que quedó.
alter table control.pagos
  add column if not exists plan_contratado text;

-- ── Las empresas que YA existen conservan su servicio ────────────────────
-- Se les deja el plan más amplio del catálogo: son de la etapa anterior al
-- cobro y quitarles capacidad por un cambio de modelo sería tratarlas como
-- si hubieran hecho algo mal. Revisable desde la consola de plataforma.
update control.empresas
   set plan_id = coalesce(plan_id, 'empresa')
 where plan = 'pago';
