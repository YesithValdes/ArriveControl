/**
 * app/docs/api/page.jsx — Ruta /docs/api
 *
 * La documentación de la API de horas extra, para quien integre un sistema
 * de nómina o de gestión con AsistencIA. Es una página pública y estática:
 * no muestra datos de ninguna empresa, solo el contrato (acceso, endpoints,
 * campos, tipos de hora y reglas del cálculo). Se abre desde Ajustes →
 * Mi empresa → Clave de API (el icono de documento).
 */

export const metadata = {
  title: 'API de horas · AsistencIA',
  description: 'Cómo consumir las horas extra de AsistencIA desde un sistema de nómina o de gestión.',
};

const CSS = `
.doc { min-height: 100dvh; background: var(--page); color: var(--ink); font-size: 14.5px; line-height: 1.55; }
.doc * { box-sizing: border-box; }
/* Barra superior a todo el ancho, como la del panel. */
.doc .barra { background: var(--btn-primary); color: #fff; padding: 12px clamp(16px, 3vw, 32px); display: flex; align-items: center; gap: 14px; flex-wrap: wrap; position: sticky; top: 0; z-index: 2; box-shadow: 0 2px 10px rgba(0,0,0,.18); }
.doc .marca { display: inline-flex; align-items: center; gap: 10px; font-family: var(--f-display); font-weight: 800; letter-spacing: .06em; font-size: 15px; }
.doc .marca svg { flex: none; border-radius: 8px; }
.doc .marca em { font-style: normal; color: #9fd3ff; }
.doc .barra .titulo { font-size: 13px; opacity: .8; padding-left: 14px; border-left: 1px solid rgba(255,255,255,.25); }
.doc .barra .base { margin-left: auto; font-family: var(--f-data); font-size: 12.5px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.22); border-radius: 8px; padding: 5px 10px; }
/* Cuerpo: índice + contenido. */
.doc .cuerpo { display: grid; grid-template-columns: 1fr; gap: 0; padding: 0 clamp(16px, 3vw, 32px) 56px; }
.doc .indice { display: flex; gap: 6px; overflow-x: auto; padding: 14px 0 4px; scrollbar-width: thin; }
.doc .indice a { flex: none; font-size: 12.5px; font-weight: 600; color: var(--ink-2); background: var(--surface-blanca); border: 1px solid var(--grid); border-radius: 999px; padding: 6px 12px; text-decoration: none; white-space: nowrap; }
.doc .indice a:hover, .doc .indice a:focus-visible { color: var(--accent); border-color: var(--accent); outline: none; }
.doc .indice .grupo { display: none; }
.doc .contenido { min-width: 0; }
.doc .portada { padding: 22px 0 6px; }
.doc .portada .eyebrow { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--accent); }
.doc .portada h1 { margin: 6px 0 8px; font-family: var(--f-display); font-size: clamp(24px, 3.2vw, 34px); font-weight: 800; letter-spacing: -.015em; line-height: 1.15; text-wrap: balance; }
.doc .portada p { margin: 0; color: var(--ink-2); max-width: 70ch; font-size: 15px; }
.doc section { padding: 26px 0 8px; border-top: 1px solid var(--grid); margin-top: 18px; scroll-margin-top: 70px; }
.doc section:first-of-type { border-top: 0; margin-top: 0; }
.doc h2 { margin: 0 0 10px; font-family: var(--f-display); font-size: 19px; font-weight: 800; letter-spacing: -.01em; }
.doc h3 { margin: 20px 0 8px; font-size: 13.5px; font-weight: 700; color: var(--ink-2); text-transform: uppercase; letter-spacing: .05em; }
.doc p { margin: 0 0 10px; max-width: 78ch; }
.doc p:last-child { margin-bottom: 0; }
.doc code { font-family: var(--f-data); font-size: .92em; background: var(--surface-blanca); border: 1px solid var(--grid); border-radius: 5px; padding: 1px 5px; }
.doc pre { margin: 10px 0 0; background: #0f1b2d; color: #e6eef8; border-radius: 10px; padding: 14px 16px; overflow-x: auto; font-family: var(--f-data); font-size: 12.5px; line-height: 1.55; }
.doc pre code { background: none; border: 0; padding: 0; color: inherit; font-size: inherit; }
.doc .ruta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.doc .metodo { font-family: var(--f-data); font-size: 12px; font-weight: 700; letter-spacing: .04em; padding: 3px 9px; border-radius: 6px; color: #fff; background: var(--accent); }
.doc .metodo.post { background: #1a7f4b; }
.doc .ruta code { font-size: 14px; font-weight: 600; }
.doc .pasos { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-top: 6px; }
.doc .paso { background: var(--surface-blanca); border: 1px solid var(--grid); border-radius: 10px; padding: 12px 13px; }
.doc .paso b { display: block; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
.doc .paso span { font-size: 13px; color: var(--ink-2); }
.doc .tabla { overflow-x: auto; margin-top: 8px; background: var(--surface-blanca); border: 1px solid var(--grid); border-radius: 10px; }
.doc table { border-collapse: collapse; width: 100%; font-size: 13px; }
.doc th, .doc td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--grid); vertical-align: top; }
.doc tr:last-child td { border-bottom: 0; }
.doc th { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 700; background: var(--page); }
.doc td.tipo { font-family: var(--f-data); font-size: 12px; color: var(--muted); white-space: nowrap; }
.doc .chip { display: inline-block; font-family: var(--f-data); font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.doc .chip.dom { background: #f3e8ff; color: #6b21a8; }
.doc .nota { border-left: 3px solid var(--accent); background: var(--accent-soft); border-radius: 0 8px 8px 0; padding: 10px 14px; font-size: 13.5px; margin-top: 12px; max-width: 78ch; }
.doc .nota.ojo { border-left-color: #8a6100; background: var(--warn-soft); }
.doc ul { margin: 6px 0 0; padding-left: 20px; }
.doc li { margin-bottom: 6px; max-width: 78ch; }
.doc .estado { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; margin-right: 4px; }
.doc .estado.pend { background: var(--page); color: var(--muted); border: 1px solid var(--grid); }
.doc .estado.parc { background: var(--warn-soft); color: #8a6100; }
.doc .estado.pag { background: var(--good-soft); color: #1a7f4b; }
.doc footer { color: var(--muted); font-size: 12.5px; padding: 28px 0 0; border-top: 1px solid var(--grid); margin-top: 26px; }
/* PC: el índice fijo a la izquierda, el contenido usa el resto del ancho. */
@media (min-width: 960px) {
  .doc .cuerpo { grid-template-columns: 230px minmax(0, 1fr); gap: 40px; }
  .doc .indice { position: sticky; top: 64px; align-self: start; flex-direction: column; gap: 2px; overflow: visible; padding: 26px 0 0; max-height: calc(100dvh - 64px); }
  .doc .indice .grupo { display: block; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin: 12px 0 4px 10px; }
  .doc .indice .grupo:first-child { margin-top: 0; }
  .doc .indice a { background: transparent; border: 0; border-radius: 8px; padding: 7px 10px; font-size: 13px; white-space: normal; }
  .doc .indice a:hover, .doc .indice a:focus-visible { background: var(--accent-soft); }
  .doc .contenido { max-width: 1100px; }
}
`;

const RESUMEN = `{
  "ok": true,
  "desde": "2026-09-01", "hasta": "2026-09-15",
  "totales": {
    "empleados": 1,
    "horas": { "HED": 9.5274, "HEN": 0, "HEDDF": 1.9936, "HENDF": 0 },
    "horasExtra": 11.521,
    "valor": 209647,            // pesos, redondeado
    "valorPendiente": 209647,   // lo que aún no se ha anotado como pagado
    "sinSalario": 0             // empleados sin salario registrado
  },
  "empleados": [
    {
      "documento": "1085420513",
      "nombre": "Andrés Erazo",
      "sede": "Sede Centro (Pasto)",
      "horas": { "HED": 9.5274, "HEN": 0, "HEDDF": 1.9936, "HENDF": 0 },
      "horasExtra": 11.521,
      "valor": 209647,
      "sinSalario": false,
      "pago": "pendiente",
      "referencias": [ "arrive-1085420513-20260902-1557-1701-HED", "…" ],
      "referenciasPendientes": [ "arrive-1085420513-20260902-1557-1701-HED", "…" ]
    }
  ]
}`;

const TRAMOS = `{
  "ok": true, "desde": "2026-09-01", "hasta": "2026-09-15", "total": 8,
  "registros": [
    {
      "documento": "1085420513",
      "nombre": "Andrés Erazo",
      "sede": "Sede Centro (Pasto)",
      "fecha": "2026-09-02",
      "horaInicio": "15:57", "horaFin": "17:01",
      "tipoHora": "HED",
      "horas": 1.0706,
      "factor": 1.25,
      "valorHora": 14761.9047,   // salario ÷ divisor (210 h de fábrica)
      "valor": 19755.119,        // valorHora × factor × horas, SIN redondear
      "pagado": false,
      "referenciaExterna": "arrive-1085420513-20260902-1557-1701-HED",
      "observaciones": "Sede Centro (Pasto) · semana del 2026-08-31"
    }
  ]
}`;

const PAGADAS = `// Cuerpo
{ "referencias": [ "arrive-1085420513-20260902-1557-1701-HED", "…" ] }
// Para deshacer: el mismo cuerpo con "pagado": false

// Respuesta
{ "ok": true, "pagado": true, "afectados": 8 }`;

export default function DocsApiPage() {
  return (
    <main className="doc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="barra">
        <span className="marca">
          <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#2b6cb0" />
            <g transform="translate(3.2 3.2) scale(0.9)" fill="none">
              <circle cx="32" cy="31" r="20" stroke="#fff" strokeWidth="4.6" />
              <circle cx="25.4" cy="27" r="2.2" fill="#fff" />
              <circle cx="38.6" cy="27" r="2.2" fill="#fff" />
              <path d="M 24 37 l 6 6 l 12 -12" stroke="#9fdcca" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </svg>
          ASISTENC<em>IA</em>
        </span>
        <span className="titulo">Documentación de la API</span>
        <span className="base">https://arrivecontrol.vercel.app</span>
      </div>

      <div className="cuerpo">
        <nav className="indice" aria-label="Contenido">
          <span className="grupo">Empezar</span>
          <a href="#acceso">Acceso</a>
          <a href="#cedula">Cruce por cédula</a>
          <a href="#flujo">Flujo por período</a>
          <span className="grupo">Endpoints</span>
          <a href="#resumen">GET /api/horas/resumen</a>
          <a href="#tramos">GET /api/horas</a>
          <a href="#pagadas">POST /api/horas/pagadas</a>
          <span className="grupo">Referencia</span>
          <a href="#tipos">Tipos de hora</a>
          <a href="#reglas">Reglas del cálculo</a>
          <a href="#errores">Errores</a>
        </nav>

        <div className="contenido">
          <div className="portada">
            <div className="eyebrow">AsistencIA · integración</div>
            <h1>API de horas extra para nómina y gestión</h1>
            <p>
              Lo que AsistencIA calcula a partir de las marcaciones de cada empleado —horas extra por tipo, su valor en pesos
              y si ya se pagaron— tal como lo muestra la pantalla de Reportes, entregado en JSON a otro sistema.
            </p>
          </div>

      <section id="acceso">
        <h2>Acceso</h2>
        <p>
          Cada empresa tiene su <b>clave de API</b>, que el administrador ve y copia en <i>Ajustes → Mi empresa → Clave de API</i>.
          Se manda en todas las peticiones en el encabezado <code>X-API-Key</code>. No hay inicio de sesión ni token que renovar:
          la clave identifica a la empresa, y con ella solo se ven <b>sus</b> empleados y sus horas. Todo va por HTTPS.
        </p>
        <pre><code>{`curl -H "X-API-Key: sSxA1sDk…" \\
  "https://arrivecontrol.vercel.app/api/horas/resumen?mes=2026-09&quincena=1"`}</code></pre>
        <div className="nota ojo">
          Si el administrador regenera la clave, la anterior deja de servir en el acto (respuesta 401). Conviene que la clave sea un
          ajuste editable por empresa en el otro sistema, no un valor fijo en el código.
        </div>
      </section>

      <section id="cedula">
        <h2>Cruce por cédula</h2>
        <p>
          En todas las respuestas cada persona viene con <code>documento</code>: la cédula <b>sin puntos ni espacios</b> (<code>"1004415216"</code>).
          Esa es la llave para cruzar con el colaborador del otro sistema. <code>nombre</code> y <code>sede</code> vienen solo de referencia.
        </p>
        <p>
          Si una cédula no existe en el otro sistema, es un colaborador que está en AsistencIA pero no allá (o al revés): conviene
          reportarlo, no descartarlo en silencio. Normalizar la cédula (quitar puntos) antes de comparar.
        </p>
      </section>

      <section id="flujo">
        <h2>Flujo por período de pago</h2>
        <p>La empresa liquida por quincena (1–15 y 16–fin de mes) o por mes. El sistema que paga hace, en cada cierre:</p>
        <div className="pasos">
          <div className="paso"><b>1 · Resumen</b><span>Pide <code>/api/horas/resumen</code> con el período: una fila por empleado con sus horas, su valor y sus referencias.</span></div>
          <div className="paso"><b>2 · Detalle (opcional)</b><span>Si necesita el tramo a tramo (día, hora de inicio y fin, tipo), pide <code>/api/horas</code> con el mismo período.</span></div>
          <div className="paso"><b>3 · Liquida</b><span>Paga en su nómina con esas cifras. AsistencIA no mueve dinero.</span></div>
          <div className="paso"><b>4 · Anota el pago</b><span>Manda a <code>/api/horas/pagadas</code> las referencias que pagó. Así el panel las muestra como pagadas y nadie las liquida dos veces.</span></div>
        </div>
        <div className="nota">
          La clave para no pagar dos veces es <code>referenciaExterna</code>: identifica un tramo concreto y es la misma cada vez que se consulta.
          Si una marcación se corrige después de pagada, el tramo nuevo trae <b>otra</b> referencia y vuelve a salir como pendiente; el sistema
          que paga debe deduplicar por referencia, nunca por fecha.
        </div>
        <h3>Cómo se indica el período</h3>
        <p>Los dos GET aceptan cualquiera de estas dos formas:</p>
        <ul>
          <li><code>mes=YYYY-MM</code> y <code>quincena=1</code> (del 1 al 15) o <code>quincena=2</code> (del 16 al fin de mes); sin <code>quincena</code>, el mes entero.</li>
          <li><code>desde=YYYY-MM-DD</code> y <code>hasta=YYYY-MM-DD</code>, para un rango cualquiera.</li>
        </ul>
      </section>

      <section id="resumen">
        <div className="ruta"><span className="metodo">GET</span><code>/api/horas/resumen?mes=2026-09&amp;quincena=1</code></div>
        <p>Las horas extra del período <b>resumidas por empleado</b>: lo mismo que la tabla de Reportes. El período es obligatorio.</p>
        <pre><code>{RESUMEN}</code></pre>
        <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 8 }}>Cifras de ejemplo, no de una empresa real.</p>
        <h3>Campos de cada empleado</h3>
        <div className="tabla"><table>
          <thead><tr><th>Campo</th><th>Tipo</th><th>Qué es</th></tr></thead>
          <tbody>
            <tr><td><code>documento</code></td><td className="tipo">string</td><td>Cédula, sin puntos. La llave para cruzar.</td></tr>
            <tr><td><code>nombre</code></td><td className="tipo">string</td><td>Nombre completo como está registrado en AsistencIA.</td></tr>
            <tr><td><code>sede</code></td><td className="tipo">string | null</td><td>Sede asignada al empleado.</td></tr>
            <tr><td><code>horas</code></td><td className="tipo">objeto</td><td>Horas por tipo (<code>HED</code>, <code>HEN</code>, <code>HEDDF</code>, <code>HENDF</code>), en horas decimales con 4 decimales: <code>1.5</code> = 1 h 30 min.</td></tr>
            <tr><td><code>horasExtra</code></td><td className="tipo">number</td><td>Suma de las cuatro.</td></tr>
            <tr><td><code>valor</code></td><td className="tipo">number | null</td><td>Pesos colombianos, redondeado <b>una sola vez</b> sobre el total de la persona. <code>null</code> si no tiene salario registrado.</td></tr>
            <tr><td><code>sinSalario</code></td><td className="tipo">boolean</td><td><code>true</code> cuando el valor no se pudo calcular por falta de salario.</td></tr>
            <tr><td><code>pago</code></td><td className="tipo">string</td><td>Estado de los tramos del período: <span className="estado pend">pendiente</span><span className="estado parc">parcial</span><span className="estado pag">pagado</span></td></tr>
            <tr><td><code>referencias</code></td><td className="tipo">string[]</td><td>Referencias de todos sus tramos del período.</td></tr>
            <tr><td><code>referenciasPendientes</code></td><td className="tipo">string[]</td><td>Las que todavía no se han anotado como pagadas. Es lo que se manda a <code>/api/horas/pagadas</code> después de liquidar.</td></tr>
          </tbody>
        </table></div>
        <h3>Totales</h3>
        <p>
          <code>totales.valor</code> es el total a pagar del período y <code>totales.valorPendiente</code> lo que aún no se ha anotado como pagado;
          <code>totales.horas</code> suma por tipo. Salen de las mismas filas, así que siempre cuadran con ellas.
        </p>
      </section>

      <section id="tramos">
        <div className="ruta"><span className="metodo">GET</span><code>/api/horas?mes=2026-09&amp;quincena=1</code></div>
        <p>
          El detalle <b>tramo a tramo</b>: cada pedazo de tiempo con recargo, con su día, hora de inicio y fin, tipo, valor y estado.
          Sin período devuelve todo el historial (no recomendado para integrar).
        </p>
        <pre><code>{TRAMOS}</code></pre>
        <h3>Campos de cada tramo</h3>
        <div className="tabla"><table>
          <thead><tr><th>Campo</th><th>Tipo</th><th>Qué es</th></tr></thead>
          <tbody>
            <tr><td><code>fecha</code></td><td className="tipo">YYYY-MM-DD</td><td>Día de Colombia en que ocurrió el tramo. Un tramo nunca cruza la medianoche: un turno nocturno se parte en dos.</td></tr>
            <tr><td><code>horaInicio</code> · <code>horaFin</code></td><td className="tipo">HH:MM</td><td>Rango del tramo dentro de ese día.</td></tr>
            <tr><td><code>tipoHora</code></td><td className="tipo">string</td><td>Uno de los cuatro códigos (ver abajo).</td></tr>
            <tr><td><code>horas</code></td><td className="tipo">number</td><td>Duración en horas decimales (4 decimales).</td></tr>
            <tr><td><code>factor</code></td><td className="tipo">number</td><td>Recargo aplicado (<code>1.25</code> = 125 %). Es el que regía <b>en la fecha del tramo</b>, no el de hoy.</td></tr>
            <tr><td><code>valorHora</code></td><td className="tipo">number | null</td><td>Valor de la hora ordinaria: salario mensual ÷ divisor (210 h de fábrica; la empresa puede cambiarlo).</td></tr>
            <tr><td><code>valor</code></td><td className="tipo">number | null</td><td>Pesos del tramo, con decimales. Redondear solo al sumar por persona o período.</td></tr>
            <tr><td><code>pagado</code></td><td className="tipo">boolean</td><td>Ya anotado como pagado.</td></tr>
            <tr><td><code>referenciaExterna</code></td><td className="tipo">string</td><td><code>arrive-{'{cédula}'}-{'{AAAAMMDD}'}-{'{HHMM inicio}'}-{'{HHMM fin}'}-{'{tipo}'}</code>. Estable entre consultas; cambia si la marcación se corrige.</td></tr>
            <tr><td><code>observaciones</code></td><td className="tipo">string</td><td>Sede y lunes de la semana a la que pertenece el tramo.</td></tr>
          </tbody>
        </table></div>
      </section>

      <section id="pagadas">
        <div className="ruta"><span className="metodo post">POST</span><code>/api/horas/pagadas</code></div>
        <p>
          Anota tramos como pagados (o deshace la anotación). Recibe <b>referencias</b>, no fechas: así lo pagado queda amarrado al tramo exacto.
          Hasta 5.000 referencias por petición. Encabezados: <code>X-API-Key</code> y <code>Content-Type: application/json</code>.
        </p>
        <pre><code>{PAGADAS}</code></pre>
        <p style={{ marginTop: 10 }}>
          <code>afectados</code> es cuántas referencias cambiaron de estado; las que ya estaban pagadas no cuentan (repetir la petición no hace daño).
          En el panel esas horas pasan a verse como pagadas, anotadas por <code>api</code>.
        </p>
      </section>

      <section id="tipos">
        <h2>Tipos de hora</h2>
        <div className="tabla"><table>
          <thead><tr><th>Código</th><th>Nombre</th><th>Factor de fábrica</th><th>Cuándo</th></tr></thead>
          <tbody>
            <tr><td><span className="chip">HED</span></td><td>Hora extra diurna</td><td className="tipo">1.25</td><td>Extra de lunes a sábado, fuera de la franja nocturna.</td></tr>
            <tr><td><span className="chip">HEN</span></td><td>Hora extra nocturna</td><td className="tipo">1.75</td><td>Extra de lunes a sábado dentro de la franja nocturna (21:00–06:00 de fábrica).</td></tr>
            <tr><td><span className="chip dom">HEDDF</span></td><td>Hora extra diurna dominical o festiva</td><td className="tipo">2.15</td><td>Todo lo trabajado en domingo o festivo, de día.</td></tr>
            <tr><td><span className="chip dom">HENDF</span></td><td>Hora extra nocturna dominical o festiva</td><td className="tipo">2.65</td><td>Todo lo trabajado en domingo o festivo, de noche.</td></tr>
          </tbody>
        </table></div>
        <p style={{ marginTop: 10 }}>
          Los factores, el divisor y la franja nocturna los ajusta cada empresa en <i>Ajustes → Valorización</i>, y llevan vigencia:
          un tramo de marzo se valoriza con lo que regía en marzo. Por eso cada tramo trae su <code>factor</code>.
        </p>
      </section>

      <section id="reglas">
        <h2>Reglas del cálculo que conviene saber</h2>
        <ul>
          <li><b>Qué es extra lo decide AsistencIA</b>, con el horario y la jornada de cada empleado. Quien liquida recibe horas ya clasificadas; no tiene que recalcular nada.</li>
          <li><b>Por semana cerrada (modo de fábrica):</b> lo que pase de la jornada semanal (42 h de lunes a sábado) es extra, y los días largos compensan los cortos. Una semana se cierra el domingo: sus extras de lunes a sábado aparecen cuando el domingo termina. Un período que corta una semana a la mitad recibe solo los tramos de sus fechas; el resto sale en el período siguiente. Conviene correr el cierre después del domingo que termina la última semana del período.</li>
          <li><b>Por día (si la empresa lo elige):</b> lo que pase de la jornada del horario de cada día es extra de ese día, y sale apenas termina el día.</li>
          <li><b>Domingo y festivo</b> van con recargo desde la primera hora, en los dos modos, y no cuentan dentro de las 42 h. Los festivos son los oficiales de Colombia más los que la empresa agregue.</li>
          <li><b>Extra mínima:</b> un exceso menor al mínimo de la empresa (30 min de fábrica; ajustable en Reglamento) no genera extra; desde ahí, entra completo.</li>
          <li><b>Entrada sin salida:</b> el día se cierra a la hora de salida del horario del empleado, para que un olvido no deje el día en cero.</li>
          <li><b>Sin salario:</b> las horas se calculan igual; <code>valor</code> viene <code>null</code>. El otro sistema puede valorizar con su propio salario usando las horas y los factores.</li>
          <li><b>Tiempos:</b> todo en fecha y hora de Colombia (<code>America/Bogota</code>). Las horas van en decimales, no en <code>HH:MM</code>: <code>0.5</code> son 30 minutos.</li>
        </ul>
      </section>

      <section id="errores">
        <h2>Errores</h2>
        <p>Toda respuesta trae <code>ok</code>. Si es <code>false</code>, <code>error</code> dice qué pasó en una frase.</p>
        <div className="tabla"><table>
          <thead><tr><th>HTTP</th><th>Cuándo</th></tr></thead>
          <tbody>
            <tr><td className="tipo">401</td><td>Sin clave de API, o clave inválida (por ejemplo, regenerada).</td></tr>
            <tr><td className="tipo">400</td><td><code>mes</code> que no es <code>YYYY-MM</code>, <code>quincena</code> distinta de 1 o 2, <code>desde</code> mayor que <code>hasta</code>, período faltante en <code>/resumen</code>, lista de referencias vacía o de más de 5.000, JSON inválido.</td></tr>
            <tr><td className="tipo">5xx</td><td>Falla del servidor. Reintentar más tarde: las lecturas no tienen efectos y el POST se puede repetir sin duplicar nada.</td></tr>
          </tbody>
        </table></div>
      </section>

          <footer>AsistencIA · arrivecontrol.vercel.app · Documentación de la API de horas</footer>
        </div>
      </div>
    </main>
  );
}
