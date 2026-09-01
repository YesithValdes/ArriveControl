-- 012_calibracion_facial.sql — Mediciones crudas para CALIBRAR el modelo v2.
--
-- Los logs [Kiosco⏱] de la consola de la tablet se pierden al cerrar la app;
-- para calibrar V2_UMBRAL_SIM / V2_MARGEN_SIM con datos reales hay que
-- PERSISTIR las mediciones de cada intento. Se agregan a `intentos_kiosco`
-- (que ya guarda aceptado/distancia/liveness) las similitudes v2 del mejor y
-- del segundo candidato, y con qué modo decidió el kiosco.
--
-- Con esto, `db/calibracion-v2.mjs` calcula percentiles de genuinos vs
-- impostores y propone los umbrales. Ningún dato biométrico viaja aquí: son
-- escalares (similitudes), no descriptores.
alter table intentos_kiosco add column if not exists v1_mejor   real;
alter table intentos_kiosco add column if not exists v1_segundo real;
alter table intentos_kiosco add column if not exists v2_mejor   real;
alter table intentos_kiosco add column if not exists v2_segundo real;
alter table intentos_kiosco add column if not exists modo       text; -- 'v1' | 'v1+veto' | 'v2'
