-- control/013_acceso_panel.sql
--
-- ¿Este kiosco muestra el acceso al panel de administración? Por defecto NO:
-- un aparato en recepción no debe invitar a nadie a «Administración». El
-- administrador lo enciende por dispositivo desde Ajustes → Dispositivos;
-- el kiosco entonces muestra el botón, que lleva al inicio de sesión con
-- correo y contraseña (Google no entra dentro de la app de Android). Es
-- solo mostrar u ocultar la puerta: la llave sigue siendo la contraseña.
alter table control.dispositivos
  add column if not exists acceso_panel boolean not null default false;
