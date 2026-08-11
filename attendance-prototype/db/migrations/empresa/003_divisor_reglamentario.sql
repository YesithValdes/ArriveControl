-- empresa/003_divisor_reglamentario.sql
-- El divisor del valor hora deja de ser un número suelto: SE DERIVA de la
-- jornada reglamentaria — horas_semana × 5 (42 → 210 h/mes).
--
-- Antes era 240 (30 días × 8 h) editable aparte, y podía quedar incoherente
-- con la jornada: una empresa con semana de 42 h dividiendo el salario entre
-- 240 paga la hora extra más barata de lo que su propia jornada dice. Atarlo
-- elimina esa incoherencia y deja UN solo número que administrar (el 42).
--
-- La columna divisor_horas_mes se conserva: las vigencias históricas la
-- necesitan y el motor la sigue leyendo. Solo cambia QUIÉN la escribe — ya no
-- un formulario propio, sino el cambio de jornada.
update config_laboral set divisor_horas_mes = horas_semana * 5;

-- Las vigencias existentes se alinean también. En una instalación con
-- historia real esto NO se haría (reescribiría valores ya liquidados); aquí
-- las vigencias solo tienen la semilla de la migración 002, todavía sin
-- liquidaciones encima, y dejarla en 240 perpetuaría la incoherencia.
update valorizacion_vigencias
   set divisor_horas_mes = (select horas_semana * 5 from config_laboral);
