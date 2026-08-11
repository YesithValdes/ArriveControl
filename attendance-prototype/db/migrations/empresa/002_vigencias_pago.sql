-- empresa/002_vigencias_pago.sql
-- Los parámetros de PAGO, con historia.
--
-- El problema que resuelve: los factores, el divisor y la franja nocturna eran
-- una sola fila (config_laboral) que se pisaba al editar. Cambiar el factor de
-- HED hoy reescribía el valor en pesos de horas extra de hace meses — y un
-- reporte de marzo debe decir siempre lo mismo, se consulte cuando se consulte.
--
-- Cómo funciona: cada cambio INSERTA una vigencia con la fecha en que empieza a
-- regir, en vez de editar la anterior. Para valorizar un tramo se busca la
-- vigencia con el `desde` más reciente que no sea posterior a la fecha del
-- tramo. La fila de config_laboral se mantiene actualizada como copia de lo
-- vigente (los formularios y el kiosco la siguen leyendo), pero la verdad
-- histórica vive aquí.
create table if not exists valorizacion_vigencias (
  -- Desde qué día rigen estos parámetros. Un solo cambio por día: si se edita
  -- dos veces el mismo día, la segunda pisa a la primera (upsert) — es una
  -- corrección, no una vigencia nueva.
  desde             date primary key,
  factores_hora     jsonb   not null,
  divisor_horas_mes integer not null check (divisor_horas_mes between 1 and 744),
  nocturno_inicio   time    not null,
  nocturno_fin      time    not null,
  creada_en         timestamptz not null default now()
);

-- Semilla: lo que hoy dice config_laboral pasa a ser la vigencia inicial, con
-- un `desde` anterior a cualquier marcación posible. Así todo lo ya registrado
-- se valoriza exactamente igual que antes de esta migración.
insert into valorizacion_vigencias
  (desde, factores_hora, divisor_horas_mes, nocturno_inicio, nocturno_fin)
select date '1950-01-01', factores_hora, divisor_horas_mes, nocturno_inicio, nocturno_fin
  from config_laboral
on conflict (desde) do nothing;
