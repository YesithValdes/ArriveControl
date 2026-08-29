# Cobro de la suscripción (Bold)

Cómo se cobra el plan de pago, qué hay que configurar y por qué está hecho así.

## El modelo comercial

| | Prueba | Gratis | Empresa |
|---|---|---|---|
| **Empleados** | ilimitados | hasta 5 | ilimitados |
| **Dura** | 30 días desde el registro | para siempre | mientras esté al día |
| **Cuesta** | $0 | $0 | ver `PRECIO_MENSUAL_COP` |

Toda empresa nueva nace con la prueba corriendo (`prueba_hasta` = hoy + 30 días).
Al vencer **no se pierde nada**: cae al plan gratuito y quien ya tenga más de 5
empleados los conserva marcando — simplemente no puede agregar más. Bloquear a
gente que ya venía usando el sistema sería el peor momento para perder al cliente.

El plan de pago se puede contratar **en cualquier momento**, también durante la
prueba: los días que queden no se pierden, porque un pago extiende desde el
vencimiento vigente y no desde hoy.

## Qué hay que configurar

Variables de entorno (en `.env.local` para desarrollo, y en Vercel para producción):

```
BOLD_API_KEY          llave de identidad (viaja al navegador, no es secreta)
BOLD_SECRET_KEY       llave secreta, para firmar el monto del checkout
BOLD_WEBHOOK_SECRET   secreto de los webhooks — VACÍO en pruebas (ver abajo)
BOLD_ENTORNO          'test' o 'prod'
PRECIO_MENSUAL_COP    monto mensual en PESOS ENTEROS ($1.000 → 1000)
```

Las llaves salen del panel de Bold, en **Llaves de pruebas** mientras se valida
la integración, y de las de producción cuando ya se cobre de verdad.

**Sin llaves el módulo queda apagado**: el botón de contratar responde que los
pagos no están habilitados, en vez de llevar a un checkout roto.

### El webhook

En el panel de Bold hay que registrar la URL de notificaciones, eligiendo el
ambiente **Sandbox** mientras se prueba:

```
https://TU-DOMINIO/api/pago/webhook
```

En desarrollo Bold no puede alcanzar `localhost`. Se prueba con un túnel
(`npx localtunnel --port 3000` o similar), o enviando el evento firmado a mano —
que es como se validó esta integración.

## Probar en el sandbox

Bold decide el resultado **por el monto**, no por la tarjeta:

| Monto | Resultado |
|---|---|
| $1.000 – $2.000.000 | aprobada |
| $111.111 | rechazada: fondos insuficientes |
| $222.222 | rechazada: PIN inválido |
| $333.333 | rechazada: tarjeta vencida |
| $444.444 | rechazada: falla de red |
| $999.999 | rechazada: rechazo general |

> **La unidad es el PESO, no el centavo.** Bold pide el monto «sin decimales»
> y su mínimo es $1.000. Poner 100000 no cobra $1.000 sino $100.000.

El precio provisional de $1.000 cae en el rango aprobado, así que el camino
feliz se prueba sin tocar nada. Para probar un rechazo, se cambia
`PRECIO_MENSUAL_COP` al monto correspondiente.

## Cómo funciona

1. La persona pulsa **Contratar plan** en Ajustes → Mi empresa.
2. `POST /api/pago/iniciar` genera un `orderId` único, **firma el monto** y
   registra el pago como `PENDIENTE`.
3. El navegador carga la librería de Bold y abre el checkout con esa
   configuración (`new BoldCheckout({...}).open()`).
4. Bold avisa a `POST /api/pago/webhook` cuando la venta se resuelve.
5. Si fue aprobada, la empresa pasa a `plan = 'pago'`, sin tope y con
   `vence_en` a 30 días.

## Las reglas que no se pueden relajar

Están implementadas y **verificadas con pruebas**; si alguien toca este código,
que sea sabiendo por qué existen.

**1. La firma del monto se calcula en el servidor.** Es un SHA256 de
`<orderId><monto><moneda><llaveSecreta>`. Sin ella, cualquiera edita el monto
antes de pagar. La propia documentación de Bold insiste en generarla en el
servidor para no exponer la llave secreta.

**2. Todo evento entrante se verifica sobre el cuerpo CRUDO.** Bold manda un
HMAC-SHA256 en la cabecera `x-bold-signature`, calculado sobre el cuerpo
codificado en Base64. Se usa el texto exacto que llegó y no el JSON
re-serializado: cualquier diferencia de espacios o de orden de claves cambiaría
el hash y haría fallar eventos legítimos. Un evento con firma inválida se
rechaza con 401 — sin esto, activarse el plan sería tan fácil como un `curl`.

> **Ojo con el sandbox:** en pruebas Bold firma con la **cadena vacía** como
> secreto. Por eso `BOLD_WEBHOOK_SECRET=` (vacío) es un valor *válido* y se
> distingue de "no configurado"; el código usa `??` y no `||` justamente por eso.

**3. El webhook es idempotente.** Bold reintenta hasta 5 veces en 24 horas si no
recibe un 200, así que el mismo pago llega varias veces. Quien lo impide es el
estado `PENDIENTE` junto con la restricción única sobre `control.pagos.transaccion`,
no un `if`. Un evento repetido responde 200 sin volver a extender la suscripción.

**4. Se responde rápido.** Bold espera el 200 en menos de 2 segundos. Por eso el
webhook no llama a servicios externos ni hace trabajo lento.

Por lo mismo se responde **200 a eventos que no nos sirven** (referencia
desconocida, otro tipo de evento): reintentarlos no cambiaría nada. El 500 se
reserva para fallos nuestros, donde el reintento sí ayuda.

## Lo que falta

- **Renovación automática.** Hoy cada mes hay que pagar a mano. Falta la tarea
  programada que cobre y avise si el cobro falla, con unos días de gracia antes
  de marcar la suscripción vencida (apagar el kiosco el mismo día de un rechazo
  sería brutal).
- **Avisos por correo** del vencimiento de la prueba (7 y 3 días).
- **Facturación electrónica.** Cobrarle a empresas obliga a facturar ante la DIAN.
  Al principio se resuelve con un proveedor externo; el NIT de cada empresa ya se
  guarda.
