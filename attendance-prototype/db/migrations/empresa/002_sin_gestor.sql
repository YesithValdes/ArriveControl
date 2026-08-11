-- empresa/002_sin_gestor.sql
-- ArriveControl deja de tener nada que ver con el gestor de nómina externo.
--
-- Es un producto independiente: los empleados se registran aquí, con nombre y
-- cédula, y esta es la única fuente de verdad sobre quién trabaja en la
-- empresa. Ya no hay «modo conectado» ni «modo autónomo» — hay un solo modo.
--
-- Lo que sobra en consecuencia:
--
--   empleados.colaborador_id  → apuntaba a una fila del gestor. Sin gestor no
--                               apunta a nada.
--   envios_rh                 → bitácora de lo que se le EMPUJABA al gestor.
--                               El empuje se eliminó hace rato (nómina consulta
--                               bajo demanda con GET /api/horas) y la tabla
--                               quedó congelada, sin escrituras nuevas.
--
-- En una empresa creada después de este cambio ninguno de los dos existe, así
-- que las dos sentencias son inofensivas: `if exists` las convierte en nada.

alter table empleados drop column if exists colaborador_id;

drop table if exists envios_rh;
