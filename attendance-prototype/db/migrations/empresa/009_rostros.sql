-- 009_rostros.sql — VARIOS rostros por empleado.
--
-- Con un solo descriptor por persona, el perfil hereda los defectos de esa
-- única foto: si salió con luz rasante o de medio lado, queda corrido en el
-- espacio de vectores y se acerca al de otra persona. Medido en producción:
-- con 11 empleados ya había una pareja POR DEBAJO del umbral de aceptación.
--
-- Con varios rostros, al marcar se compara contra el MÁS PARECIDO de los
-- suyos (nunca contra un promedio: promediar fotos distintas produce un punto
-- que no representa a ninguna y puede acercarse a otra persona).
--
-- `empleados.descriptor_facial` se conserva: es el rostro principal y lo que
-- leen las consultas viejas. Esta tabla lo complementa.
create table if not exists rostros (
  id          text primary key default gen_random_uuid()::text,
  empleado_id text not null references empleados(id) on delete cascade,
  -- 128 floats. DATO BIOMÉTRICO (Ley 1581), igual que descriptor_facial:
  -- nunca sale de aquí salvo al kiosco, y la foto original jamás se guarda.
  descriptor  real[] not null,
  -- 'registro' = tomado al dar de alta o agregado a mano desde la ficha.
  origen      text not null default 'registro',
  creado_en   timestamptz not null default now()
);

create index if not exists rostros_empleado_idx on rostros (empleado_id);

-- El rostro que ya tenía cada empleado pasa a ser el primero de su lista, para
-- que la comparación al mínimo funcione igual desde el primer día.
insert into rostros (empleado_id, descriptor, origen)
select id, descriptor_facial, 'registro'
  from empleados
 where descriptor_facial is not null
   and not exists (select 1 from rostros r where r.empleado_id = empleados.id);
