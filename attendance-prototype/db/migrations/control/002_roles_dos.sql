-- control/002_roles_dos.sql
-- DOS roles, no cinco. La decisión es de producto, no técnica:
--
--   superadmin → la PLATAFORMA. Da de alta empresas y, sobre todo, da de baja
--                las que quedaron sin usar: en un registro self-service cada
--                cuenta abandonada deja un esquema muerto en el catálogo de
--                Postgres, y alguien tiene que poder limpiarlo. No entra al
--                panel de asistencia de nadie.
--
--   empresa    → dueño absoluto de SU esquema: empleados, marcaciones,
--                correcciones, sedes, configuración y dispositivos.
--
-- Antes había tres roles DENTRO de la empresa (dueno, supervisor, consulta).
-- Se van a propósito: la confidencialidad de los datos es de la empresa, y
-- repartir permisos internos es problema suyo, no de la plataforma. Varias
-- personas de la misma empresa siguen pudiendo entrar —cada una con su Google—
-- pero todas con el mismo poder.
--
-- Lo que esto CUESTA, por si hay que revisarlo en el futuro: quien liquida la
-- nómina puede editar las marcaciones que liquida. Era lo que evitaba el rol
-- `consulta`.

-- ORDEN: soltar el check viejo, luego convertir las filas, luego poner el
-- nuevo. Al revés no funciona — el check anterior solo admite los tres roles
-- viejos, así que rechazaría el propio update que los está migrando.
alter table control."user" drop constraint if exists user_rol_check;

update control."user" set rol = 'empresa'
 where rol in ('dueno', 'supervisor', 'consulta');

alter table control."user"
  add constraint user_rol_check check (rol in ('superadmin', 'empresa'));
alter table control."user" alter column rol set default 'empresa';

-- El superadmin no pertenece a ninguna empresa, y eso hay que poder afirmarlo:
-- un superadmin con empresa_id sería alguien con acceso de plataforma Y datos
-- de un cliente, que es justo lo que este diseño separa.
alter table control."user" drop constraint if exists user_superadmin_sin_empresa;
alter table control."user"
  add constraint user_superadmin_sin_empresa
  check (rol <> 'superadmin' or empresa_id is null);

-- `sede_id` era el alcance del supervisor. Sin supervisor no limita nada, y
-- dejarlo invitaría a creer que sigue filtrando algo.
alter table control."user" drop column if exists sede_id;

-- Las invitaciones heredan el mismo cambio: se invita a la empresa, no a un rol.
alter table control.invitaciones drop constraint if exists invitaciones_rol_check;
update control.invitaciones set rol = 'empresa' where rol <> 'empresa';
alter table control.invitaciones
  add constraint invitaciones_rol_check check (rol = 'empresa');
alter table control.invitaciones alter column rol set default 'empresa';
alter table control.invitaciones drop column if exists sede_id;
