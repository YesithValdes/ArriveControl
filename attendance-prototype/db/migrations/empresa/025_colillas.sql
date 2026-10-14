-- empresa/025_colillas.sql
--
-- Colilla de pago (desprendible) de HORAS de un colaborador en un período:
-- días y horas trabajadas, horas extra y recargos por tipo con su valor, y
-- el estado del cierre. No es la nómina (sin salario básico ni deducciones):
-- es el comprobante de lo que mide ArriveControl.
--
-- Se guarda CONGELADA al generarla (`datos`): consultarla después muestra lo
-- mismo aunque cambien salarios, reglas o marcaciones. Generarla otra vez
-- para el mismo período crea una nueva; la anterior queda en el historial.
create table if not exists colillas (
  id           text primary key default gen_random_uuid()::text,
  empleado_id  text not null references empleados(id),
  -- Copias para mostrarla tal cual aunque el colaborador cambie después.
  documento    text,
  nombre       text not null,
  desde        date not null,
  hasta        date not null,
  datos        jsonb not null,
  generada_en  timestamptz not null default now(),
  generada_por text
);
create index if not exists colillas_empleado on colillas (empleado_id, generada_en desc);
