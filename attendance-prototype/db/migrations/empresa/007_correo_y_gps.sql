-- 007_correo_y_gps.sql — Comprobante por correo y ubicación de la marcación.
--
-- `correo`: a dónde se envía el comprobante de cada marcación (entrada/salida,
-- hora oficial y ubicación). Opcional: sin correo no se envía nada.
--
-- `lat/lon/precision_m` en marcaciones: desde dónde se marcó, según el GPS del
-- dispositivo. Se guarda cuando el empleado tiene `validar_ubicacion` (registro
-- del punto exacto) y sirve para exigir el rango cuando tiene `validar_sede`
-- (la marcación debe caer dentro del radio de su sede).
alter table empleados
  add column if not exists correo text;

alter table marcaciones
  add column if not exists lat         double precision,
  add column if not exists lon         double precision,
  add column if not exists precision_m integer;
