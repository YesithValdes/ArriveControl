# Cobro de la suscripción (Bold)

Cómo se cobra el plan de pago, qué hay que configurar y por qué está hecho así.

## El modelo comercial

**Usar el sistema exige suscripción vigente.** No hay plan gratuito ni prueba:
sin pagar se puede entrar al panel y exportar el historial, pero el kiosco no
registra marcaciones y no se pueden dar de alta empleados.

La puerta de entrada es deliberadamente barata, y sirve de filtro: quien pone
un dólar tiene medio de pago y voluntad real de usar el producto — algo que una
prueba gratuita no demuestra.

| Paquete | Precio | Cubre | Disponible |
|---|---|---|---|
| Entrada · 1 mes | US$1 | 30 días | una sola vez |
| Entrada · 2 meses | US$2 | 60 días | una sola vez |
| Entrada · 3 meses | US$3 | 90 días | una sola vez |
| Renovación | US$15 | 30 días | siempre |

Todos incluyen el producto completo, con empleados ilimitados.

**La oferta de entrada es de una sola vez por empresa.** No hace falta una
columna que lo marque: se ofrece solo si la empresa no tiene ningún pago
aprobado en su historial. Un dato derivado no se puede desincronizar del hecho
que representa. Y se valida **en el servidor** al iniciar el pago, no solo al
pintar la pantalla: ocultar un botón no impide llamar a la ruta.

**Renovar antes de vencer no cuesta días.** El pago extiende desde el
vencimiento vigente, no desde hoy.

**El catálogo vive en `lib/planes.js`**, en el servidor. Del navegador solo se
acepta *cuál* paquete se quiere; cuánto cuesta y cuánto dura lo decide el
servidor. Si el precio viniera del cliente, cualquiera pediría tres meses por
un dólar.

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

Bold decide el resultado **por el monto**, no por la tarjeta. Su documentación
lista estos casos **en pesos**:

| Monto | Resultado |
|---|---|
| $1.000 – $2.000.000 | aprobada |
| $111.111 | rechazada: fondos insuficientes |
| $222.222 | rechazada: PIN inválido |
| $333.333 | rechazada: tarjeta vencida |
| $444.444 | rechazada: falla de red |
| $999.999 | rechazada: rechazo general |

> **Pendiente de comprobar:** cobramos en **dólares**, y esa tabla está escrita
> para pesos. En la primera prueba del sandbox conviene verificar qué desenlace
> produce US$1 antes de dar por buenos esos valores.

## Cómo funciona

1. La persona elige un paquete en Ajustes → Mi empresa.
2. `POST /api/pago/iniciar` valida el paquete contra el catálogo, comprueba que
   la oferta no esté usada, genera un `orderId` único, **firma el monto** y
   registra el pago como `PENDIENTE` con los meses que cubre.
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

## Sobre la moneda

Se cobra en **dólares**; Bold convierte a pesos con la TRM del momento y el
comercio recibe en COP. La contrapartida: **en USD solo se puede pagar con
tarjeta** — quedan fuera PSE y Nequi, que en Colombia son medios muy usados. Si
la conversión resulta baja, cambiar a pesos es tocar `MONEDA` y los precios en
`lib/planes.js`.

## Lo que falta

- **Renovación automática.** Hoy cada mes hay que pagar a mano. Falta la tarea
  programada que cobre y avise si el cobro falla, con unos días de gracia antes
  de marcar la suscripción vencida (apagar el kiosco el mismo día de un rechazo
  sería brutal).
- **Avisos por correo** del vencimiento de la prueba (7 y 3 días).
- **Facturación electrónica.** Cobrarle a empresas obliga a facturar ante la DIAN.
  Al principio se resuelve con un proveedor externo; el NIT de cada empresa ya se
  guarda.
