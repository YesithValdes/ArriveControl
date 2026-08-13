-- 006_validar_ubicacion.sql — Preferencia de ubicación para empleados SIN sede.
--
-- `validar_sede` (005) limita la marcación a la sede asignada. Este flag es
-- el complemento para quien NO tiene sede: si al marcar se debe registrar la
-- ubicación GPS del dispositivo, para saber desde dónde se hizo. Hoy se
-- guarda la preferencia; la captura de GPS en la marcación llega con el flujo
-- de marcación por teléfono.
alter table empleados
  add column if not exists validar_ubicacion boolean not null default false;
