-- 006_valorizacion_horas.sql
-- Valorización en pesos de las horas extra.
--
-- Hasta ahora ArriveControl solo decía QUÉ horas eran extra y de qué clase;
-- cuánto valían era problema de quien liquidara. Con esto el panel puede
-- mostrar el valor generado por cada persona sin salir a preguntarle a nadie.
--
-- Todo lo que define el pago queda como PARÁMETRO editable desde
-- Ajustes → Valorización de horas extra, nunca escrito en el código: los
-- factores cambian con la reforma laboral y con lo que pacte cada empresa.

-- ── Salario por empleado (OPCIONAL) ──────────────────────────────────
-- Nullable a propósito: registrar a alguien no debe exigir saber su sueldo.
-- Sin salario, sus horas se siguen contando y clasificando; simplemente no se
-- les pone un valor en pesos — es preferible un guion en el reporte a una
-- cifra inventada que alguien podría terminar pagando.
alter table asistencia.empleados
  add column if not exists salario_mensual numeric(14, 2)
  check (salario_mensual is null or salario_mensual > 0);

comment on column asistencia.empleados.salario_mensual is
  'Salario mensual en COP. NULL = sin registrar: sus horas no se valorizan.';

-- ── Parámetros de valorización (fila única de config_laboral) ─────────

-- Divisor para pasar de salario mensual a valor de la hora ordinaria.
-- 240 = 30 días × 8 h, el uso más extendido en nómina colombiana. Se deja
-- configurable porque quien siga la Ley 2101 al pie de la letra prefiere
-- derivarlo de la jornada vigente (42 h/sem → 180 h/mes).
alter table asistencia.config_laboral
  add column if not exists divisor_horas_mes integer not null default 240
  check (divisor_horas_mes between 1 and 744);

-- Factor de pago por tipo de hora. Es el multiplicador TOTAL sobre la hora
-- ordinaria (1.25 ya incluye la hora misma), no el sobrecosto: así se lee
-- igual que la tabla del reglamento y valorizar es una sola multiplicación.
alter table asistencia.config_laboral
  add column if not exists factores_hora jsonb not null
  default '{"HED": 1.25, "HEN": 1.75, "HEDDF": 2.15, "HENDF": 2.65}'::jsonb;

comment on column asistencia.config_laboral.factores_hora is
  'Factor TOTAL sobre la hora ordinaria por código de hora extra. Editable en Ajustes.';

-- Franja nocturna: dentro de ella una extra es HEN/HENDF en vez de HED/HEDDF.
-- 21:00–06:00 (CST art. 160, reformado por la Ley 789 de 2002). Configurable
-- porque hay empresas con turnos que pactan otro corte.
alter table asistencia.config_laboral
  add column if not exists nocturno_inicio time not null default '21:00';
alter table asistencia.config_laboral
  add column if not exists nocturno_fin time not null default '06:00';
