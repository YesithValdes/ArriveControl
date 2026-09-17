-- empresa/016_avatar.sql
--
-- Foto de PERFIL del empleado: una imagen cualquiera que lo identifique en
-- las listas del panel (foto, avatar, símbolo). NO tiene nada que ver con el
-- reconocimiento facial: los rostros viven en `rostros` como descriptores y
-- esta imagen nunca se usa para reconocer a nadie. Se guarda ya normalizada
-- (JPEG 256×256, unos 15 KB) y la puede poner el panel o el sistema de
-- gestión por la API (PUT /api/empleados/{cedula}/avatar).
alter table empleados
  add column if not exists avatar bytea,
  add column if not exists avatar_en timestamptz;
