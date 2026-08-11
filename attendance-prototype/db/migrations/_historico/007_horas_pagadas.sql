-- 007_horas_pagadas.sql
-- Marca de "estas horas extra ya se pagaron".
--
-- OJO con lo que esto es y lo que NO es: ArriveControl no paga nada, quien
-- paga es la nómina. Esto es una ANOTACIÓN de que algo ya se liquidó afuera,
-- útil para no pagar dos veces lo mismo — no es un comprobante de pago.
--
-- Se guarda por TRAMO y no por (empleado, período) aunque en pantalla el
-- usuario marque una fila entera: si la marca dependiera del rango de fechas
-- elegido, cambiar el rango en el reporte dejaría las marcas huérfanas. La
-- referencia externa, en cambio, identifica un tramo concreto y es estable
-- entre recálculos (ver lib/calculoHoras.js).
--
-- Efecto secundario buscado: si alguien corrige una marcación ya pagada, el
-- tramo se recalcula con OTRA referencia y vuelve a aparecer como no pagado.
-- Eso es exactamente el aviso que se quiere — algo cambió después de pagar.
create table if not exists asistencia.horas_pagadas (
  -- La referencia del tramo: arrive-{cédula}-{fecha}-{inicio}-{fin}-{código}.
  referencia_externa text primary key,
  -- Cédula, repetida aquí a propósito: permite consultar y auditar lo pagado
  -- de una persona sin tener que parsear la referencia.
  documento          text        not null,
  pagado_en          timestamptz not null default now(),
  -- Quién lo marcó. Texto y no FK: si el usuario se borra, la auditoría de un
  -- pago no puede desaparecer con él.
  pagado_por         text
);

-- El reporte pregunta siempre "¿qué está pagado de esta persona?".
create index if not exists horas_pagadas_documento_idx
  on asistencia.horas_pagadas (documento);
