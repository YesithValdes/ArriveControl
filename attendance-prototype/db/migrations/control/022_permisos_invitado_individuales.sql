-- NULL significa permisos de Administrador para un nuevo Invitado.
alter table control."user" add column if not exists permisos_invitado text[];
alter table control.invitaciones add column if not exists permisos_invitado text[];

-- Conservar las restricciones actuales al separar a cada persona.
update control."user" u set permisos_invitado = e.permisos_invitado
from control.empresas e
where u.empresa_id = e.id and u.rol = 'invitado' and u.permisos_invitado is null;

update control.invitaciones i set permisos_invitado = e.permisos_invitado
from control.empresas e
where i.empresa_id = e.id and i.rol = 'invitado' and i.permisos_invitado is null
  and i.aceptada_en is null and i.expira_en > now();
