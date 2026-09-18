-- empresa/017_cierres.sql
--
-- CIERRES de período: la liquidación de horas extra de una persona en un
-- período (quincena o mes), guardada TAL COMO SE PAGÓ. Mientras un período
-- está abierto, Reportes lo calcula en vivo con la configuración de hoy (un
-- cambio en Ajustes aplica a toda la app); al cerrarlo —desde Reportes o
-- desde el sistema de nómina por la API— queda congelado aquí y ya no lo
-- mueve ningún cambio posterior. Ese es el historial.
--
-- Se cierra por persona (una fila por cédula y período). «Cerrar el período
-- completo» es cerrar a todos los que tenían extras en él. Reabrir borra la
-- fila y el período vuelve a calcularse en vivo.
create table if not exists cierres (
  id           bigserial primary key,
  desde        date not null,
  hasta        date not null,
  documento    text not null,               -- cédula, la llave con nómina
  nombre       text,
  cerrado_en   timestamptz not null default now(),
  cerrado_por  text,                        -- correo del panel, o 'api'
  horas        jsonb not null,              -- {HED, HEN, HEDDF, HENDF}
  horas_extra  numeric(10,4) not null,
  valor        numeric(14,2),               -- null = sin salario al cerrar
  tramos       jsonb not null,              -- los tramos tal como se liquidaron
  unique (desde, hasta, documento)
);
create index if not exists cierres_periodo_idx on cierres (desde, hasta);
