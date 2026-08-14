-- control/005_reconexion.sql
-- Reconectar un dispositivo EXISTENTE con un código, sin crear otro.
--
-- Caso real: se borran los datos de la app (o se cambia la tablet) y la clave
-- del aparato se pierde. Antes tocaba crear un dispositivo nuevo y el viejo
-- quedaba de basura en la lista. Ahora la vinculación puede apuntar a un
-- dispositivo ya registrado: al canjear el código, ese dispositivo recibe una
-- clave NUEVA (la anterior deja de servir al instante) y vuelve a quedar
-- activo, conservando su nombre, su sede y su historial.
alter table control.vinculaciones
  add column if not exists dispositivo_id text references control.dispositivos(id) on delete cascade;
