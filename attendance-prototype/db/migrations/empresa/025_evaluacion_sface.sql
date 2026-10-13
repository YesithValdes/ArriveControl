-- Evaluación del modelo SFace en el kiosco web (lib/sfaceWeb.js).
--
-- Corre EN SOMBRA: el modelo actual sigue decidiendo quién marca; SFace solo
-- se mide con la misma imagen. Nada de esto toca `rostros` ni `marcaciones`.
--
-- Solo funciona si el superadmin habilitó la empresa
-- (control.empresas.laboratorio_facial) Y el administrador la puso en una
-- fase activa. Por defecto está APAGADA.
--
-- Fases: 'apagada' → 'inscripcion' (cada marcación confirmada guarda vectores
-- SFace de esa persona, hasta 3) → 'medicion' (cada marcación se compara con
-- SFace y se anota el resultado) → 'apagada'. Con `hasta`, se apaga sola.

create table if not exists eval_sface_config (
  id              boolean primary key default true check (id),
  estado          text not null default 'apagada'
                  check (estado in ('apagada', 'inscripcion', 'medicion')),
  hasta           timestamptz,
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);
insert into eval_sface_config (id) values (true) on conflict do nothing;

-- Vectores SFace (128 floats, L2). DATO BIOMÉTRICO (Ley 1581): solo bajan a
-- los kioscos de la empresa mientras la evaluación está activa.
create table if not exists eval_sface_rostros (
  id             text primary key default gen_random_uuid()::text,
  empleado_id    text not null references empleados(id) on delete cascade,
  vector         real[] not null,
  dispositivo_id text,
  creado_en      timestamptz not null default now()
);
create index if not exists eval_sface_rostros_empleado on eval_sface_rostros (empleado_id);

-- Cada comparación en sombra. Sin fotos ni vectores: solo el resultado.
create table if not exists eval_sface_intentos (
  id              text primary key default gen_random_uuid()::text,
  ts              timestamptz not null default now(),
  dispositivo_id  text,
  referencia_id   text references empleados(id) on delete set null, -- a quién dio el modelo actual
  aceptado_actual boolean not null,
  sim_actual      real,
  sface_top1      text references empleados(id) on delete set null,
  sface_sim1      real,
  sface_top2      text references empleados(id) on delete set null,
  sface_sim2      real,
  inscritos       integer not null default 0,
  ms              integer,
  error           text
);
create index if not exists eval_sface_intentos_ts on eval_sface_intentos (ts desc);
