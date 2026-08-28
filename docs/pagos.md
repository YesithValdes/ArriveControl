# Cobro de la suscripción (Wompi)

Cómo se cobra el plan de pago, qué hay que configurar y por qué está hecho así.

## El modelo comercial

| | Prueba | Gratis | Empresa |
|---|---|---|---|
| **Empleados** | ilimitados | hasta 5 | ilimitados |
| **Dura** | 30 días desde el registro | para siempre | mientras esté al día |
| **Cuesta** | $0 | $0 | ver `PRECIO_MENSUAL_CENTAVOS` |

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
WOMPI_PUBLIC_KEY          llave pública    (viaja al navegador, no es secreta)
WOMPI_INTEGRITY_SECRET    secreto de integridad, para firmar el monto
WOMPI_EVENTS_SECRET       secreto de eventos, para verificar los webhooks
WOMPI_ENTORNO             'test' o 'prod'
PRECIO_MENSUAL_CENTAVOS   monto mensual EN CENTAVOS ($1.000 → 100000)
```

Las llaves salen del panel de Wompi, en **Mi cuenta**. Empieza con las de
sandbox (`pub_test_…`) y no pases a las de producción hasta haber visto un pago
completo de punta a punta.

**Sin estas variables el módulo queda apagado**: el botón de contratar responde
que los pagos no están habilitados, en vez de llevar a un checkout roto.

### El webhook

En el panel de Wompi hay que registrar la URL de eventos:

```
https://TU-DOMINIO/api/pago/webhook
```

En desarrollo, Wompi no puede alcanzar `localhost`. Se prueba de dos formas: con
un túnel (`npx localtunnel --port 3000` o similar), o enviando el evento a mano
con `curl` — que es como se validó esta integración.

## Cómo funciona

1. La persona pulsa **Contratar plan** en Ajustes → Mi empresa.
2. `POST /api/pago/iniciar` genera una referencia única, **firma el monto** y
   registra el pago como `PENDIENTE`.
3. El navegador se va al checkout de Wompi con esos datos.
4. Wompi avisa a `POST /api/pago/webhook` cuando la transacción se resuelve.
5. Si fue aprobada, la empresa pasa a `plan = 'pago'`, sin tope y con
   `vence_en` a 30 días.

## Las tres reglas que no se pueden relajar

Están implementadas y **verificadas con pruebas**; si alguien toca este código,
que sea sabiendo por qué existen.

**1. La firma del monto se calcula en el servidor.** Es un SHA256 de
`<referencia><montoEnCentavos><moneda><secretoDeIntegridad>`. Sin ella, cualquiera
edita el monto en la URL y paga mil pesos por un plan de cien mil. Si el secreto
llegara al navegador, la firma dejaría de significar nada.

**2. Todo evento entrante se verifica.** Wompi manda un checksum en la cabecera
`X-Event-Checksum`: se concatenan los campos que el propio evento lista en
`signature.properties`, más su `timestamp` y el secreto de eventos. Un evento con
firma inválida se rechaza con 401 — sin esto, activarse el plan de pago sería tan
fácil como un `curl`.

**3. El webhook es idempotente.** Wompi reintenta hasta 3 veces en 24 horas si no
recibe un 200, así que el mismo pago llega varias veces. Quien lo impide es la
restricción única sobre `control.pagos.transaccion` y el estado `PENDIENTE`, no un
`if`. Un evento repetido responde 200 sin volver a extender la suscripción.

Por eso también se responde **200 a eventos que no nos sirven** (referencia
desconocida, otro tipo de evento): reintentarlos no cambiaría nada. El 500 se
reserva para fallos nuestros, donde el reintento sí ayuda.

## Lo que falta

- **Renovación automática.** Hoy cada mes hay que pagar a mano. Wompi permite
  guardar un token del medio de pago y cobrar después; falta la tarea programada
  que lo haga y avise si el cobro falla, con unos días de gracia antes de marcar
  la suscripción vencida (apagar el kiosco el mismo día de un rechazo sería
  brutal).
- **Avisos por correo** del vencimiento de la prueba (7 y 3 días).
- **Facturación electrónica.** Cobrarle a empresas obliga a facturar ante la DIAN.
  Al principio se resuelve con un proveedor externo; el NIT de cada empresa ya se
  guarda.
