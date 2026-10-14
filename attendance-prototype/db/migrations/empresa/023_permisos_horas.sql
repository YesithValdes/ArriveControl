alter table permisos add column if not exists hora_inicio time;
alter table permisos add column if not exists hora_fin time;
alter table permisos add constraint permisos_horas_completas check (
 (hora_inicio is null and hora_fin is null) or
 (hora_inicio is not null and hora_fin is not null and inicio + hora_inicio < fin + hora_fin)
);
