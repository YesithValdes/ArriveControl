# Seguridad: llaves por empresa y acceso de soporte

## La arquitectura

- Cada empresa tiene una **DEK de 256 bits** que cifra sus datos sensibles (AES-256-GCM).
- La DEK **nunca** se guarda en claro. Está en `control.empresa_llaves`, envuelta dos veces:
  - con la **llave maestra del servidor** (`ARRIVE_LLAVE_MAESTRA`). Es la que se usa en el día a día.
  - con la **llave de recuperación de la empresa**. Solo la conoce el dueño. La genera desde *Ajustes → Seguridad* y se le muestra **una sola vez**.
- El **superadmin no tiene acceso permanente** a los datos de ninguna empresa.
- El **soporte** solo entra cuando la empresa lo autoriza (`control.soporte_autorizaciones`):
  - máximo **72 horas**, impuesto también por la base;
  - en **solo lectura** (acción `ver` y método GET/HEAD);
  - cada consulta e intento queda en `control.soporte_accesos`, que no se puede editar ni borrar (lo impide un trigger).

| Pieza | Archivo |
|---|---|
| Tablas | `attendance-prototype/db/migrations/control/017_llaves_y_soporte.sql` |
| Primitivas (AES-GCM, HKDF, llave de recuperación) | `lib/cifrado.js` |
| DEK de cada empresa: crear, abrir, cifrar, recuperar, rotar | `lib/llaves.js` |
| Autorizaciones y bitácora de soporte | `lib/soporte.js` |
| Modo soporte dentro de `estadoAcceso` | `lib/sesion.js` |
| Método y ruta reales para la bitácora | `middleware.js` |
| API del dueño | `/api/empresa/llaves`, `/api/soporte`, `/api/soporte/[id]` |
| API del superadmin | `/api/plataforma/soporte` |
| Pantallas | `components/SeguridadEmpresa.jsx` (Ajustes → Seguridad), `components/SoportePlataforma.jsx` (consola → Soporte) |

### Garantías de los sobres cifrados

Cada sobre va atado con *datos asociados* (aad) a la **empresa** y al **uso**:

- una DEK envuelta copiada a otra empresa no se abre;
- un dato cifrado de una columna no se abre en otra.

Los sobres llevan la versión de la llave con que se cifraron, para que las rotaciones no rompan nada.

### Al borrar una empresa

- Sus llaves se borran en cascada (borrado criptográfico).
- Las autorizaciones y la bitácora de soporte **se conservan**: no tienen llave foránea, a propósito.

## Variables de entorno

| Variable | Qué es |
|---|---|
| `ARRIVE_LLAVE_MAESTRA` | 32 bytes en base64. Se genera con `node db/llaves.mjs nueva-maestra`. |
| `ARRIVE_LLAVE_MAESTRA_ID` | Nombre de la maestra vigente (por defecto `m1`). |
| `ARRIVE_LLAVE_MAESTRA_ANTERIOR` y `_ID` | Solo mientras se rota la maestra. |

Sin `ARRIVE_LLAVE_MAESTRA` la app sigue funcionando igual que antes:

- las empresas nacen sin DEK;
- *Ajustes → Seguridad* avisa que el cifrado no está activo;
- el soporte autorizado funciona igual, porque no depende de la DEK.

> **Guarda la llave maestra fuera de Vercel** (gestor de contraseñas o bóveda). Si se pierde, la única forma de recuperar la DEK de cada empresa es su llave de recuperación.

## Operación

```bash
cd attendance-prototype
node db/llaves.mjs nueva-maestra      # imprime una maestra nueva, no toca la base
node db/llaves.mjs estado             # qué empresas tienen DEK y recuperación
node db/llaves.mjs provisionar        # crea la DEK de las empresas que no tengan
node db/llaves.mjs rotar-maestra      # re-envuelve con la vigente lo que esté con la ANTERIOR
```

Contra una base que no sea `localhost`, todo lo que escribe exige `--produccion`. Lo mismo pasa con `node db/migrate.mjs`.

Si una empresa perdió su DEK porque se perdió la maestra:

- `restaurarConRecuperacion(empresa, llave)` en `lib/llaves.js` la recupera con la llave de recuperación de la empresa;
- después la vuelve a envolver con la maestra vigente.

## Pruebas

```bash
npm test                                   # incluye tests/cifrado.mjs (19 pruebas, sin base)
DATABASE_URL=postgresql://…@localhost:…/… node db/probar-seguridad.mjs   # 24 pruebas contra base LOCAL
```

## Qué está cifrado hoy y qué falta (Etapa 2b)

**La infraestructura está completa, pero todavía no se cifró ninguna columna existente.**

El siguiente paso es usar `cifrarDato` y `descifrarDato` en los datos sensibles:

- vectores faciales (`rostros`, `empleados.descriptor_facial`);
- cédula;
- correo;
- salario;
- avatar;
- GPS de las marcaciones.

Va en una etapa aparte porque:

1. **La cédula se busca y debe ser única.** Esto incluye la API de nómina, `cierres.documento`, `horas_pagadas` y el avatar por cédula. Cifrada necesita un **índice ciego** (HMAC con una llave derivada de la DEK) además del sobre.
2. **Los datos de producción hay que re-cifrarlos.** Se hace con una migración por lotes que convive con filas en claro: `descifrarDato` devuelve tal cual lo que no es sobre. Esa migración se prueba primero en local con una copia y se corre en producción solo cuando se decida.
3. **El kiosco sigue recibiendo los vectores en claro** para reconocer. La DEK protege la base y los respaldos, no los dispositivos. Endurecer los aparatos (almacenamiento cifrado, `allowBackup=false` en la app Capacitor) es otro frente.
4. **Lo que corre sin nadie conectado** (cron, API de nómina, webhook) también descifrará con la maestra. Ya está contemplado en `lib/llaves.js`.

## Límites, dichos con honestidad

- **Quien controle las variables de producción tiene la maestra**, y con ella puede abrir las DEK. La garantía de "sin acceso permanente" se apoya en tres cosas:
  - separar quién administra Vercel y la base;
  - el registro de cada acceso de soporte;
  - que la aplicación no tiene otro camino a los datos.
- **Un superusuario de Postgres podría desactivar los triggers** de la bitácora. Eso ya es una decisión deliberada y deja rastro en los registros de la base, no un descuido de la app.
