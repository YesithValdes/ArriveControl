-- control/003_indice_invitaciones.sql
-- La búsqueda de invitaciones pendientes filtra por vencimiento en cada primer
-- ingreso; sin índice, con miles de invitaciones acumuladas eso es un scan.
-- Parcial: las aceptadas son histórico y no se consultan por fecha.
create index if not exists invitaciones_pendientes_vencimiento
  on control.invitaciones (expira_en) where aceptada_en is null;
