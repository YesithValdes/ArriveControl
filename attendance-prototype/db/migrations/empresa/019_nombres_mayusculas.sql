-- Los nombres de los colaboradores se guardan en MAYÚSCULAS: así salen
-- iguales en el panel, el kiosco, la app, los reportes y los correos.
-- El servidor los normaliza al crear y al editar (app/api/empleados).
update empleados set nombre = upper(nombre) where nombre <> upper(nombre);
