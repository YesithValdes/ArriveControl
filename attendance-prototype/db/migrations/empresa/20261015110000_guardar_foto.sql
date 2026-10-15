-- Preferencia por colaborador: guardar (o no) la foto de cada marcación.
-- Por defecto sí, como hasta ahora. Con false la marcación se registra igual,
-- pero `foto` queda vacía (lib/marcaciones.js).
alter table empleados
  add column if not exists guardar_foto boolean not null default true;
