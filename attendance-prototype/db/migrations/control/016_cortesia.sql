-- control/016_cortesia.sql — Empresas de cortesía: gratis y sin vencimiento.
--
-- Una empresa de cortesía cuenta como suscripción vigente sin pagar ni tener
-- `vence_en`: opera el kiosco, usa la API y no tiene topes de plan. Es un
-- acuerdo explícito de la plataforma, no un plan del catálogo, por eso es una
-- columna aparte y no un `plan_id` más (el catálogo es lo que se vende).
--
-- SmartGadgets —la empresa dueña del producto— es la primera: su sistema de
-- gestión lee las horas por la API, y la API es de los planes pagos. En
-- producción su esquema es `empresa_de_smartgadgets` (nació por el registro
-- self-service, no por la migración a multiempresa): verificado en la base.
alter table control.empresas
  add column if not exists cortesia boolean not null default false;

update control.empresas set cortesia = true where esquema = 'empresa_de_smartgadgets';
