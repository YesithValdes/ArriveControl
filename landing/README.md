# Landing de Control Registro

Sitio de marketing. **Vive aparte de la aplicación a propósito**: se despliega como su
propio proyecto, así que nada de lo que se haga aquí puede romper el kiosco ni el panel,
que ya tienen empresas usándolos todos los días.

Es HTML estático, sin build ni dependencias. Se edita con cualquier editor y carga en
milisegundos.

```
index.html          la página de ventas
politica-datos.html política de tratamiento de datos (BORRADOR, ver abajo)
```

## Verla mientras se trabaja

Basta abrir `index.html` con doble clic en el navegador. Si prefieres servirla:

```bash
npx serve .          # o: python -m http.server 3001
```

## Lo que hay que completar antes de publicar

1. **El precio.** En `index.html`, busca `PRECIO`: hay dos comentarios que marcan
   exactamente dónde va. Hoy el plan de pago dice «A tu medida».
2. **El correo de contacto.** Busca `CONTACTO` en `index.html`; hoy apunta al correo
   personal.
3. **La política de datos.** `politica-datos.html` describe con exactitud lo que el
   sistema hace, pero los datos del responsable (razón social, NIT, dirección, correo)
   están como marcadores. **Debe revisarla un abogado antes de publicarla**: los datos
   biométricos son sensibles bajo la Ley 1581 y su tratamiento exige autorización previa,
   expresa e informada de cada trabajador.

## Publicarla

Como proyecto propio en Vercel, separado del de la aplicación:

```bash
cd landing
vercel --prod
```

Cuando tengas dominio, apúntalo a este proyecto y deja la aplicación donde está. Los
botones de la landing ya enlazan a `https://arrivecontrol.vercel.app/login`; si la
aplicación cambia de dirección, hay que actualizar esos enlaces (son cinco, todos con esa
URL).
