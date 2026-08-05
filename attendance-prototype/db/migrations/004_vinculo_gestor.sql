-- 004_vinculo_gestor.sql
-- El gestor de empleados es la UNICA fuente de identidad: cada empleado de
-- asistencia nace de un colaborador del gestor (public.colaborador) y guarda
-- su id. La cedula se conserva como copia legible (y para las referencias de
-- los envios a nomina), pero el vinculo fuerte es colaborador_id: si corrigen
-- una cedula en el gestor, el vinculo no se rompe.
-- Sin FK fisica entre esquemas (mismo criterio que correcciones.admin_user_id):
-- el registro valida contra public.colaborador en el momento del alta.
alter table asistencia.empleados
  add column if not exists colaborador_id uuid;

-- Un colaborador solo puede estar registrado una vez en asistencia.
create unique index if not exists empleados_colaborador_unico
  on asistencia.empleados (colaborador_id) where colaborador_id is not null;
