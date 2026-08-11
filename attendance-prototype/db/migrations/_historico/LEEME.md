# Migraciones históricas (ya aplicadas, ya no se ejecutan)

Estas ocho migraciones construyeron el esquema `asistencia` cuando ArriveControl
servía a **una sola empresa**. `db/migrate.mjs` ya no las mira: quedan aquí como
historia y como referencia de por qué cada columna existe.

Su contenido vive ahora repartido en dos plantillas:

| Antes (aquí)                  | Ahora                                  |
|-------------------------------|----------------------------------------|
| `001_esquema_asistencia.sql`  | `empresa/001_base.sql` (sin las tablas de identidad) |
| `002_horas_dia.sql`           | `empresa/001_base.sql` · `config_laboral` |
| `003_jornada_semanal.sql`     | `empresa/001_base.sql` · `empleados`   |
| `004_dispositivos.sql`        | `control/001_control.sql` — el kiosco no tiene sesión |
| `004_vinculo_gestor.sql`      | `empresa/001_base.sql` · `empleados.colaborador_id` |
| `005_usuarios_propios.sql`    | `control/001_control.sql` — la identidad es compartida |
| `006_valorizacion_horas.sql`  | `empresa/001_base.sql` · `config_laboral`, `empleados.salario_mensual` |
| `007_horas_pagadas.sql`       | `empresa/001_base.sql` · `horas_pagadas` |

**Por qué se consolidaron.** Una migración incremental solo tiene sentido si hay
un esquema viejo al que aplicársela. Cada empresa nueva nace vacía, así que para
ella las ocho se resumen en un único acto de creación. `empresa/001_base.sql` es
esa creación, y está escrita con `create table if not exists` para que correrla
sobre el esquema que ya existe sea inofensiva.

**El riesgo que eso introduce**, y cómo se cubre: esos archivos pasan a ser el
acta de nacimiento de toda empresa nueva, y cualquier diferencia entre lo que
dicen y lo que realmente tiene el esquema viejo no se notaría hasta crear la
segunda empresa. Por eso existe `node db/verificar-plantilla.mjs`, que crea un
esquema desechable, le aplica la plantilla y compara su estructura contra la
del esquema real, columna por columna.
