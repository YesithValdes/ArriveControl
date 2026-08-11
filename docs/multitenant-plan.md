# Multitenant: un esquema por empresa

Plan de implementación. **Nada de esto está hecho todavía** — es el documento a
revisar antes de escribir código.

Decisiones ya tomadas (2026-08-10):

- Un esquema por empresa, no una columna `empresa_id` con RLS.
- La empresa se resuelve **desde el usuario de la sesión**.
- El esquema llega a las consultas por **`search_path` fijado en cada petición**.
- **Se entra con Google y registrarse es gratis.** El registro crea la empresa
  y su esquema de inmediato. Se paga al pasar de **10 empleados**, no antes.
- **Quien autoriza es la invitación, no el dominio del correo.**
- Al vencer la suscripción de una empresa de pago: **solo lectura y
  exportación**, datos intactos. Una empresa gratuita nunca vence.

Sin definir todavía:

- **Con qué pasarela se cobra.** El diseño no depende de eso (ver §2), pero
  hasta elegirla el paso a plan de pago se hace a mano.

Tamaño del cambio hoy: **~124 referencias a `asistencia.` en 33 archivos**.

---

## 1. Modelo de datos


```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ESQUEMA  control                                          existe UNA vez    ║
║  El directorio: quién es cliente · quién entra · qué tablet marca            ║
╚══════════════════════════════════════════════════════════════════════════════╝

              ┌───────────────────────────────────────┐
              │ empresas                              │
              ├───────────────────────────────────────┤
              │ PK  id             uuid               │
              │ UQ  esquema        't_kupocell' ──────┼──► nombra el esquema
              │     nombre · nit                      │      de datos
              │ UQ  api_key                     ──────┼──► la usa nómina en
              │     estado   activa|vencida|cancelada │      GET /api/horas
              │     plan · vence_en · pago_*          │
              └───────┬───────────────────────┬───────┘
                      │ id                    │ id
              empresa_id                empresa_id
                      │                       │
   ┌──────────────────┴──────────┐   ┌────────┴─────────────────────┐
   │ user        (Better Auth)   │   │ dispositivos      (kiosco)   │
   ├─────────────────────────────┤   ├──────────────────────────────┤
   │ PK  id            text      │   │ PK  id            text       │
   │ UQ  email         global    │   │ FK  empresa_id               │
   │ FK  empresa_id    NULL = ①  │   │ UQ  clave_hash    sha256     │
   │     rol   dueno|superv|cons │   │     nombre                   │
   │     sede_id  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │   │     sede_id  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
   │     activo                  │   │     activo · ultimo_uso      │
   └───────┬─────────────────────┘   └──────────────────────────────┘
           │ id                          ┊                    ┊
   ┌───────┼───────────┐                 ┊  ambos apuntan a   ┊
   │       │           │                 ┊  «sedes», que está ┊
   ▼       ▼           ▼                 ┊  en el esquema de  ┊
┌────────┐┌──────────┐┌────────────────┐ ┊  la empresa ── SIN ┊
│session ││ account  ││ verification   │ ┊  llave foránea     ┊
│FK user ││ FK user  ││  identifier    │ ┊  (ver ② abajo)     ┊
│UQ token││ password ││  value         │ ┊                    ┊
└────────┘└──────────┘└────────────────┘ ┊                    ┊
                                         ┊                    ┊
   _migraciones   ← migraciones de control                    ┊
                                         ┊                    ┊
              ┌──────────────────────────┴────────────────────┘
              │        el esquema se elige EN CADA PETICIÓN
              │        SET LOCAL search_path = t_kupocell
              ▼
      ┌───────────────┬───────────────┬───────────────┐
      ▼               ▼               ▼               ▼
 t_kupocell        t_acme         t_eltrigo        t_…      (uno por cliente)


╔══════════════════════════════════════════════════════════════════════════════╗
║  ESQUEMA  t_kupocell                              uno POR CADA empresa       ║
║  Ninguna tabla lleva empresa_id: el esquema YA es la frontera                ║
╚══════════════════════════════════════════════════════════════════════════════╝

                    ┌──────────────────────────┐
                    │ sedes                    │
                    ├──────────────────────────┤
        ┌──────────►│ PK  id          text     │◄──────────┐
        │           │ UQ  nombre               │           │
        │           │     lat · lon · radio_m  │           │
        │           └────────────┬─────────────┘           │
        │ sede_id                │ id                      │ sede_id
        │                        │ sede_id                 │
┌───────┴──────────────────┐     │      ┌──────────────────┴───────────┐
│ empleados                │     │      │ marcaciones                  │
├──────────────────────────┤     │      ├──────────────────────────────┤
│ PK  id           text    │◄────┼──────┤ FK  empleado_id              │
│ UQ  cedula   (por empresa)     │      │ FK  sede_id                  │
│ FK  sede_id              │─────┘      │     tipo    entrada|salida   │
│     entrada/salida_esper.│            │     ts · ts_dispositivo      │
│     almuerzo_min         │            │     origen  kiosco|manual|…  │
│     descriptor_facial ⚠  │            │     eliminada   (baja lógica)│
│     jornada_semanal      │            └───────────┬──────────────────┘
│     salario_mensual      │                        │ id
│     colaborador_id       │                        │ marcacion_id
│     activo               │                        ▼
└───────┬──────────────────┘         ┌──────────────────────────────┐
        │ id                         │ correcciones     (auditoría) │
        │ empleado_id                ├──────────────────────────────┤
        ▼                            │ FK  marcacion_id             │
┌──────────────────────────┐         │     admin_user_id ┄┄┄┄┄┄┄┄┄┄ ┼┄► control.user
│ intentos_kiosco          │         │     admin_email              │   (sin FK: la
├──────────────────────────┤         │     accion · motivo          │   auditoría no
│ FK  empleado_id          │         │     valor_anterior/nuevo     │   se borra con
│ FK  sede_id              │         └──────────────────────────────┘   el usuario)
│     aceptado · distancia │
│     liveness_ok · ts     │
└──────────────────────────┘

┌──────────────────────────┐  ┌───────────────────────┐  ┌────────────────────┐
│ config_laboral   1 fila  │  │ horas_pagadas         │  │ envios_rh          │
├──────────────────────────┤  ├───────────────────────┤  ├────────────────────┤
│ PK  id    bool  = true ③ │  │ PK  referencia_externa│  │ FK  empleado_id    │
│     horas_semana · _dia  │  │     documento  cédula │  │     referencia_ext.│
│     gracia_min           │  │     pagado_en         │  │     payload  jsonb │
│     festivos    date[]   │  │     pagado_por        │  │     estado         │
│     divisor_horas_mes    │  └───────────────────────┘  │  (histórico        │
│     factores_hora  jsonb │                             │   congelado)       │
│     nocturno_inicio/fin  │   _migraciones  ← de ESTA   └────────────────────┘
└──────────────────────────┘                    empresa


─────────────────────────────────────────────────────────────────────────────
  LEYENDA
  ───────
  ──────►   llave foránea real: la base la valida
  ┄┄┄┄┄►   referencia SIN llave foránea: hay que validarla en código
  PK UQ FK  clave primaria · único · foránea
  ⚠         dato biométrico (Ley 1581)

  ①  user.empresa_id NULL = entró (p. ej. con Google) pero aún no tiene
     empresa. No autoriza nada: solo ve la pantalla de suscripción.

  ②  user.sede_id y dispositivos.sede_id apuntan a «sedes», que vive en el
     esquema de la empresa. Como ese esquema cambia por fila, una columna no
     puede referenciarlo: una llave foránea apunta a UNA tabla fija. Hay que
     cubrir en código:  · limpiar al borrar una sede
                        · verificar que la sede sea de la MISMA empresa

  ③  El truco de la fila única: la clave primaria es un boolean con
     check(id), así que solo cabe el valor `true`. Imposible tener dos
     configuraciones laborales.
─────────────────────────────────────────────────────────────────────────────
```


### `core` — esquema compartido

Existe una sola vez. Aquí vive todo lo que hay que leer **antes** de saber de
qué empresa se trata.

```sql
core.empresas
  id         uuid primary key
  esquema    text unique   -- 'emp_kupocell'; check ^emp_[a-z0-9_]{1,40}$
  nombre     text
  api_key    text unique   -- la que usa nómina en GET /api/horas
  creada_en  timestamptz
  -- Suscripción. Campos neutros a propósito: la pasarela todavía no está
  -- elegida y el resto del sistema no debe enterarse de cuál es.
  estado     text          -- 'activa' | 'vencida' | 'cancelada'
  plan       text
  vence_en   timestamptz
  pago_proveedor  text     -- 'wompi' | 'stripe' | 'manual' | …
  pago_referencia text     -- id de la suscripción en esa pasarela

core."user"      -- movida desde asistencia
  empresa_id uuid null references core.empresas(id)  -- NULL = aún no paga

core.session     -- movidas tal cual
core.account
core.verification
core.dispositivos -- movida desde asistencia, + empresa_id
```

`user.empresa_id` es **anulable a propósito**: es lo que hace seguro el
registro abierto. Ver §2.

### `emp_<slug>` — un esquema por empresa

Las tablas operativas, idénticas a las de hoy y **sin prefijo de esquema** en
el SQL de sus migraciones:

```
sedes · empleados · marcaciones · correcciones
config_laboral · intentos_kiosco · horas_pagadas
envios_rh (histórico congelado) · _migraciones
```

### Por qué los usuarios NO pueden vivir en el esquema de la empresa

Es el huevo y la gallina: para saber a qué empresa pertenece alguien hay que
leer su usuario, pero para leer su usuario habría que saber ya en qué esquema
buscar.

Se suma una restricción de la librería: [`lib/auth.js`](../attendance-prototype/lib/auth.js)
fija `search_path=asistencia,public` **en el pool**, y Better Auth consulta sus
tablas sin prefijo de esquema. Ese `search_path` se define al crear el pool, no
por petición, así que no puede variar por empresa.

Esto resulta ser una ventaja de diseño: **quedan dos pools con dos
responsabilidades limpias**.

| Pool | `search_path` | Cambia por petición |
|---|---|---|
| `lib/auth.js` (sesiones) | `core, public`, fijo | No, nunca |
| `lib/db.js` (datos) | el de la empresa | Sí, en cada petición |

### Por qué los dispositivos del kiosco también suben a `core`

El kiosco **no tiene sesión**: se autentica con `X-Device-Key`. Habría que
encontrar el dispositivo antes de saber la empresa — el mismo huevo y la misma
gallina. Por eso `dispositivos` vive en `core` con su `empresa_id`.

Lo mismo aplica a `ARRIVECONTROL_API_KEY`, que hoy es **una sola variable de
entorno**: con varias empresas cada una necesita su clave propia, y por eso
`core.empresas.api_key`. La variable de entorno se conserva como respaldo para
instalaciones de una sola empresa.

### Consecuencia a aceptar: `user.sede_id` pierde su llave foránea

Hoy es `sede_id text references asistencia.sedes(id) on delete set null`
([005_usuarios_propios.sql:29](../attendance-prototype/db/migrations/005_usuarios_propios.sql#L29)).

Postgres **sí** permite llaves foráneas entre esquemas, así que técnicamente
se podría dejar apuntando a `emp_kupocell.sedes`. Pero eso clavaría una tabla
compartida a una empresa concreta, que es justo lo contrario de lo que se
busca. Hay que **quitar la FK** y dejar `sede_id` como un texto sin validar
por la base.

Quién lo cuida entonces: la pantalla de Usuarios, que ya solo ofrece sedes de
la empresa del usuario. Y al borrar una sede hay que limpiar a mano los
usuarios que apuntaban a ella — antes lo hacía el `on delete set null`.

---

## 2. Alta de empresa, ingreso y suscripción

### Google identifica; `empresa_id` autoriza

Entrar con Google demuestra una sola cosa: que esa persona controla ese correo.
No demuestra que trabaje en KUPOCELL. Son dos conceptos distintos y conviene no
volver a mezclarlos.

Por eso `disableSignUp` pasa a `false`: el registro es gratis y abierto.

### El orden del primer ingreso — importa

```
Entra con Google por primera vez
   │
   ├─ ¿hay INVITACIÓN pendiente para ese correo?
   │      SÍ → toma empresa_id, rol y sede de la invitación
   │           y entra al panel de ESA empresa
   │
   └─ NO → se crea una empresa nueva:
           fila en control.empresas (plan 'gratis', límite 10)
           create schema · migraciones · config_laboral · api_key
           el usuario queda de `dueno`
```

**Primero se busca la invitación, y solo después se crea empresa.** Al revés, la
persona que su jefe invitó terminaría con una empresa propia y vacía en lugar de
entrar a la de él — y el jefe no entendería por qué.

El alta completa va en **una transacción**: en Postgres el `create schema` y las
migraciones son transaccionales, así que una empresa a medio crear no puede
quedar existiendo.

### El límite de 10 empleados

El plan gratuito no caduca ni recorta el panel: solo topa la plantilla.

> Con `plan = 'gratis'`, registrar el empleado número 11 se rechaza y se ofrece
> el pago. **Solo esa acción.** Todo lo demás sigue funcionando igual.

El conteo vive en el esquema de la empresa (`select count(*) from empleados
where activo`) y el tope en `control.empresas.limite_empleados` — es una columna
y no una constante para poder subírsela a un cliente puntual sin migrar nada.

El límite se verifica en el SERVIDOR, no en la pantalla: el alta de empleados
entra por `POST /api/empleados`, que es la ruta a proteger.

### Un solo punto de alta, sin atarse a la pasarela

El alta se encapsula en **una función con un contrato claro**, y quien la llama
es lo que cambia:

```
lib/empresas.js → crearEmpresa({ nombre, correoDueño, plan })
        ↑                              ↑
  el registro con Google        script o webhook
  (node db/crear-empresa.mjs)   (Wompi / Stripe / lo que sea)
```

Nada del resto del sistema —esquemas, migraciones, envoltorio— se entera de
cuál es la pasarela. Elegirla después no obliga a reescribir nada de esto.

La operación completa va en **una transacción**: en Postgres el `create schema`
y las migraciones son transaccionales, así que una empresa a medio crear no
puede quedar existiendo.

### Suscripción vencida: solo lectura

Los datos quedan **intactos**. La empresa entra, consulta y exporta su
historial; lo que se corta es escribir.

La regla se apoya en el vocabulario de permisos que ya existe en
[`lib/roles.js`](../attendance-prototype/lib/roles.js) y cabe en una línea:

> Si la suscripción está vencida, la única acción permitida es **`ver`**.

Las otras cinco (`corregir`, `empleados`, `config`, `usuarios`, `liquidar`)
son todas de escritura, así que se bloquean sin enumerarlas. La exportación a
CSV se arma en el navegador con datos que se leen con `ver`, así que **sigue
funcionando sola**, sin ninguna excepción especial.

Falta un candado aparte: **el kiosco**. `POST /api/marcaciones` entra por
`X-Device-Key`, no por sesión, así que no pasa por `estadoAcceso`. Tiene que
consultar el estado de la empresa del dispositivo y rechazar la marcación.

Esto es deliberado y conviene decirlo en el contrato de venta: se retiene el
servicio, no los datos. Son registros laborales, y negarle a una empresa el
acceso a su propia asistencia puede convertirse en un problema legal tuyo.

### Estados nuevos de acceso

[`estadoAcceso()`](../attendance-prototype/lib/sesion.js) ya devuelve
`SIN_SESION`, `CUENTA_INACTIVA` y `SIN_PERMISO`. Se le suman dos:

| Estado | Cuándo | Qué ve |
|---|---|---|
| `SIN_EMPRESA` | `empresa_id` es NULL | Pantalla de bienvenida |
| `SUSCRIPCION_VENCIDA` | `plan = 'pago'` y `estado <> 'activa'` | Panel en solo lectura |

Con el registro gratuito, `SIN_EMPRESA` casi no se ve: quien entra sale con
empresa, propia o por invitación. Queda para dos casos reales — que el alta
falle a mitad, y que alguien llegue con una **invitación vencida**. Ese segundo
merece su propio mensaje («tu invitación venció, pídele otra a tu
administrador»); si cae en la pantalla genérica va a pensar que el sistema se
equivocó.

Y `SUSCRIPCION_VENCIDA` solo aplica a quien pasó a plan de pago. **Una empresa
gratuita nunca vence**: su único tope son los 10 empleados.

---

## 3. Resolución de la empresa en cada petición

Tres caminos de entrada, tres formas de llegar al mismo dato:

| Entrada | Credencial | Cómo se resuelve |
|---|---|---|
| Panel | cookie de sesión | `core."user".empresa_id` |
| Kiosco | `X-Device-Key` | `core.dispositivos.empresa_id` |
| Nómina | `X-API-Key` | `core.empresas.api_key` |

`estadoAcceso()` en [`lib/sesion.js`](../attendance-prototype/lib/sesion.js) pasa
a devolver también `empresa` y `esquema`. Es el punto natural: **todas las rutas
del panel ya lo llaman**, así que no hay que agregar una llamada nueva en cada
handler — solo leer un campo más del objeto que ya reciben.

El mapa `empresa_id → esquema` se cachea en memoria con TTL corto, como ya se
hace con la config del gestor: son pocas filas y cambian casi nunca.

---

## 4. El envoltorio de conexión

El corazón del cambio, y donde está el único riesgo serio.

```js
// lib/db.js
export async function conEmpresa(esquema, fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`set local search_path to ${ident(esquema)}`)
    const r = await fn(client)
    await client.query('commit')
    return r
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}
```

Y el SQL queda sin prefijos:

```js
await conEmpresa(esquema, (db) =>
  db.query('select id, nombre from empleados where activo'))
```

### Por qué hay una transacción

`set local` **solo existe dentro de una transacción** y se deshace solo al
hacer `commit` o `rollback`. Sin transacción habría que usar `set` a secas y
después `reset`, y si algo falla entre medias la conexión vuelve al pool
**con el esquema de otra empresa puesto**. Esa es exactamente la fuga que hay
que hacer imposible.

Efecto secundario bienvenido: cada petición pasa a ser atómica.

### Cómo se cierra la puerta al escape

El peligro de `search_path` es una consulta que se ejecute **fuera** del
envoltorio. Tres candados, y el segundo es el que de verdad importa:

1. **`lib/db.js` deja de exportar `pool`.** Solo exporta `conEmpresa`. Una
   consulta suelta no tiene contra qué correr.

2. **El rol de la aplicación tiene `search_path` vacío por defecto**
   (`alter role app set search_path = ''`). Así, una consulta que se escape del
   envoltorio **no encuentra las tablas y falla con un error ruidoso**, en vez
   de leer en silencio los datos de otra empresa. Falla cerrado, no abierto.

3. Una prueba automatizada que verifique justamente eso: consultar sin
   envoltorio tiene que lanzar excepción.

Sin el punto 2, los otros dos son disciplina; con él, es la base la que impide
el error.

---

## 5. Migraciones

Las migraciones se parten en dos carpetas:

```
db/migrations/core/      → se aplican UNA vez
db/migrations/empresa/   → se aplican a CADA esquema de empresa
```

Las de `empresa/` se escriben **sin prefijo de esquema**, igual que las
consultas. `migrate.mjs` gana dos responsabilidades: llevar el registro de
`core._migraciones` y recorrer `core.empresas` aplicando lo pendiente en cada
esquema.

Crear una empresa nueva pasa a ser: crear el esquema → correr todas las
migraciones de `empresa/` → insertar la fila de `config_laboral`.

### La trampa de reescribir las migraciones existentes

Al renombrar `asistencia` → `emp_kupocell`, el registro `_migraciones` viaja
adentro y sigue diciendo que 001–007 están aplicadas. Por eso reescribir esos
archivos para quitarles el prefijo **no los vuelve a ejecutar** en la empresa
que ya existe.

Ahí está el riesgo: esos archivos pasan a ser el **acta de nacimiento de toda
empresa nueva**, y cualquier diferencia entre lo que dicen y lo que realmente
tiene el esquema viejo no se va a notar hasta que crees la empresa número 2.

Mitigación obligatoria: crear un esquema vacío desde cero y **comparar su
estructura contra la del esquema existente**. Si difieren, el acta está mal.

---

## 6. Orden de trabajo

Cada paso deja la aplicación funcionando.

Lo primero que conviene entender: **la empresa que ya existe no se migra, se
declara**. Sus datos operativos (1.151 marcaciones, 604 intentos, 14 empleados,
3 sedes…) no se mueven ni un byte. Lo único que cambia de lugar son las **4
filas** de `user`, `session` y `account`, que suben a `core`. El esquema
`asistencia` ya está aislado — solo le falta la etiqueta que diga de quién es.

1. **`core` y `empresas`.** Crear el esquema, mover `user`, `session`,
   `account`, `verification` y `dispositivos`. Apuntar el pool de `auth.js` a
   `core`. Registrar la empresa actual **apuntando al esquema que ya existe**:

   ```sql
   insert into core.empresas (nombre, esquema, api_key)
   values ('KUPOCELL', 'asistencia', '…');
   ```

2. **`lib/db.js`**: `conEmpresa`, dejar de exportar `pool`, `search_path` vacío
   en el rol.
3. **`lib/sesion.js`**: `estadoAcceso` devuelve `empresa` y `esquema`. Resolver
   también las vías de kiosco y API key.
4. **Reescribir consultas** para que no lleven prefijo, primero `lib/`
   (marcaciones, nomina, dispositivos, configLaboral) y después `app/api/`. Son
   ~124 líneas; la app no arranca a medias, así que se hace de corrido.
5. **`migrate.mjs`** por esquema, y `lib/empresas.js` con `crearEmpresa()`
   expuesta por el script `db/crear-empresa.mjs` (§2).
6. **Pruebas de aislamiento** (sección 7), ya con una segunda empresa de prueba.
7. Actualizar los scripts sueltos de `db/`: `crear-usuario.mjs`,
   `seed-demo.mjs`, `test-marcaciones.mjs`.
8. **Opcional y al final**: renombrar `asistencia` → `emp_kupocell`.

Hasta aquí el multitenant funciona y el alta la haces tú con el script. Lo que
sigue convierte eso en un servicio que se vende solo, y **no bloquea nada de lo
anterior**:

9. **Ingreso con Google.** Agregar el proveedor social en `auth.js` con sus
   credenciales y pasar `disableSignUp` a `false`. Es seguro **porque** el
   usuario nace con `empresa_id = NULL` (§2).
10. **Estados `SIN_EMPRESA` y `SUSCRIPCION_VENCIDA`** en `estadoAcceso`, con la
    pantalla de suscripción y la regla de solo lectura. Más el candado del
    kiosco, que no pasa por ahí.
11. **Invitaciones**: el dueño invita un correo desde Ajustes → Usuarios; al
    entrar con Google, ese correo queda con el `empresa_id` de quien lo invitó.
12. **Pasarela de pago**, cuando esté elegida: un webhook que llama a
    `crearEmpresa()` y otro que actualiza `estado` y `vence_en`.

### Por qué el renombre va al final (o no va)

Renombrar antes de tiempo rompe la aplicación: los ~124 `asistencia.` del
código apuntarían a un esquema inexistente, y quedaría rota durante todos los
pasos intermedios.

Hecho al final es **trivial**, porque para entonces ningún archivo menciona el
nombre: solo vive en la fila de `core.empresas`. Renombrar es una sentencia y
actualizar esa fila.

```sql
alter schema asistencia rename to emp_kupocell;
update core.empresas set esquema = 'emp_kupocell' where esquema = 'asistencia';
```

En la base el renombre no arrastra nada: Postgres actualiza solo tablas,
índices, secuencias y llaves foráneas, y se comprobó que **`asistencia` no
tiene ninguna FK que cruce de esquema**.

También es legítimo **no renombrar nunca**. El código lee el nombre desde
`core.empresas`, no lo asume. Queda la asimetría de que la primera empresa se
llame `asistencia` y las demás `emp_*`, pero funcionalmente da igual.

---

## 7. Pruebas de aislamiento

No son opcionales: son la única evidencia de que el multitenant funciona.

- Dos empresas con datos distintos y dos sesiones → cada una ve solo lo suyo.
- Un usuario recién creado con Google (`empresa_id` NULL) → **no ve nada**, en
  ninguna ruta del panel ni de la API.
- Empresa con suscripción vencida → puede leer y exportar; **cualquier
  escritura falla**, y el kiosco rechaza la marcación.
- Una consulta **fuera** del envoltorio → falla (candado 2).
- El `X-Device-Key` de la empresa A **no** puede registrar una marcación en B.
- El `X-API-Key` de A **no** devuelve horas de B.
- Un supervisor de sede sigue limitado a su sede **dentro** de su empresa.
- Crear una empresa vacía y comparar su estructura con la existente.

---

## 8. Límites de este diseño

Cosas que quedan fuera a propósito, para que no sorprendan después:

- **Una persona pertenece a una sola empresa.** Si algún día un contador debe
  atender a varias, el modelo cambia: `user` deja de tener `empresa_id` y
  aparece una tabla `usuario_empresa`, más un selector de empresa en el panel.
- **Las migraciones se corren N veces**, una por empresa, y con el registro
  gratuito **N no tiene techo**: cada persona que se registre con Google crea un
  esquema, use el sistema o no. Son ~14 tablas y ~17 índices por empresa, así
  que 10.000 registros son ~310.000 objetos de catálogo y una migración pasa a
  ser 10.000 transacciones. Los respaldos y el `autovacuum` cargan lo mismo.

  Decisión tomada a conciencia (2026-08-10): se acepta a cambio de que
  registrarse sea instantáneo y de un solo camino en el código. El abuso
  masivo tiene techo natural —crear cuentas de Google en volumen no es
  trivial—; lo que va a pesar es el abandono normal.

  Dos salidas si algún día molesta, ninguna urgente hoy:
  · crear el esquema en el PRIMER USO real (primer empleado o primer kiosco)
    en vez de en el registro — quien abandona costaría una fila;
  · un proceso que elimine esquemas sin ninguna marcación tras N meses, con
    aviso previo y respaldo en los términos del servicio.
- **Una cuenta de Google, una empresa.** Si alguien debe pertenecer a dos
  (un contador con varios clientes), aplica el límite de arriba: hay que pasar
  a `usuario_empresa` y un selector de empresa en el panel.
- **Respaldos por empresa**: `pg_dump --schema=emp_x` funciona, pero restaurar
  una sola empresa sin tocar las demás hay que probarlo antes de prometerlo.
- **La configuración laboral es por empresa** (jornada, festivos, factores de
  hora extra, salarios). Eso ya funciona así; solo conviene tenerlo presente:
  no hay valores globales que se hereden.
- **`GESTOR_URL` sigue siendo una variable de entorno global.** Si dos empresas
  usan gestores de nómina distintos, esto también tiene que mudarse a
  `core.empresas`.
