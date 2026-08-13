-- control/004_vinculaciones.sql
-- Códigos para activar un kiosco SIN iniciar sesión en el aparato.
--
-- Por qué existe: el kiosco corre dentro de la app de Android, y Google no
-- permite autenticarse dentro de la ventana de una app (bloquea los
-- `disallowed_useragent`). Android abre Chrome, la sesión queda allá y el
-- WebView sigue sin nada. Hacer OAuth ahí exigiría enlaces profundos, tocar el
-- manifiesto y recompilar el APK.
--
-- Y era resolver el problema equivocado: un kiosco NUNCA necesita sesión.
-- Después de activarse trabaja solo con su clave de dispositivo. La sesión hace
-- falta una única vez, para autorizar el aparato — y eso lo puede hacer el
-- administrador desde su computador, donde sí tiene sesión.
--
-- Es el mismo emparejamiento de un Chromecast o un Smart TV, por el mismo
-- motivo: el aparato no tiene teclado cómodo ni dueño que inicie sesión.
--
-- Vive en `control` porque quien lo canjea NO tiene sesión ni clave todavía:
-- el código es lo único que identifica de qué empresa se trata.
create table if not exists control.vinculaciones (
  -- 8 dígitos. Se muestra como 1234-5678 pero se guarda sin guion.
  -- Ocho y no seis: son 100 millones de combinaciones en vez de un millón, y
  -- quien adivine uno se lleva un kiosco autorizado de una empresa ajena.
  codigo     text primary key check (codigo ~ '^[0-9]{8}$'),

  empresa_id uuid not null references control.empresas(id) on delete cascade,

  -- Lo que se decidió al generarlo: así el aparato no elige nada y no puede
  -- ponerse una sede que no le corresponde.
  nombre     text not null,
  sede_id    text,   -- del esquema de la empresa: sin llave foránea

  creada_por text,
  creada_en  timestamptz not null default now(),
  -- Corta a propósito: un código que sirve para siempre es una llave suelta.
  expira_en  timestamptz not null default now() + interval '15 minutes',
  -- De un solo uso. Se conserva la fila usada como rastro de quién activó qué.
  usada_en   timestamptz
);

-- Las consultas son «códigos vivos de esta empresa» y «canjear este código».
create index if not exists vinculaciones_empresa_idx
  on control.vinculaciones (empresa_id) where usada_en is null;
