-- La evaluación deja de ser solo de SFace: el administrador elige QUÉ modelos
-- se evalúan (utils/evaluacionSface.js → MODELOS). Las tablas conservan el
-- nombre eval_sface_* para no romper nada; cada fila dice ahora su modelo.
--
-- Por defecto solo SFace. AuraFace (260 MB) se activa a propósito.
alter table eval_sface_config
  add column if not exists modelos text[] not null default array['sface'];

alter table eval_sface_rostros
  add column if not exists modelo text not null default 'sface';
alter table eval_sface_rostros drop constraint if exists eval_sface_rostros_modelo_check;
alter table eval_sface_rostros
  add constraint eval_sface_rostros_modelo_check check (modelo in ('sface', 'auraface'));
create index if not exists eval_sface_rostros_modelo on eval_sface_rostros (modelo, empleado_id);

alter table eval_sface_intentos
  add column if not exists modelo text not null default 'sface';
alter table eval_sface_intentos drop constraint if exists eval_sface_intentos_modelo_check;
alter table eval_sface_intentos
  add constraint eval_sface_intentos_modelo_check check (modelo in ('sface', 'auraface'));
