-- Evaluación de modelos faciales (laboratorio SFace / AuraFace): la habilita
-- el SUPERADMIN por empresa, desde la consola de plataforma. Apagada para
-- todas: sin esto, la empresa no ve el laboratorio ni puede enviar pruebas.
-- No toca la asistencia: el modelo de reconocimiento en uso sigue igual.
alter table control.empresas add column if not exists laboratorio_facial boolean not null default false;
