-- empresa/018_resumen_diario.sql — A dónde va el resumen diario.
--
-- Cada noche se arma, por colaborador, el resumen de su día (marcaciones,
-- horas trabajadas, novedades). Hasta ahora solo salía por correo. La empresa
-- elige, en Ajustes → Reglamento:
--   resumen_correo  se manda al correo de cada colaborador (lo de siempre).
--   resumen_api     el sistema de la empresa lo CONSULTA con la clave de API
--                   (GET /api/resumen-diario). No se envía a ningún lado.
-- Las dos encendidas por defecto: nadie pierde lo que ya tenía.
alter table config_laboral
  add column if not exists resumen_correo boolean not null default true,
  add column if not exists resumen_api boolean not null default true;
