/**
 * lib/xlsx.js — Libros de Excel (.xlsx) de una o varias hojas, sin dependencias.
 *
 * Un .xlsx es un zip con unos pocos XML (Office Open XML). Para una tabla
 * plana —el reporte de horas— basta con eso, y así no se carga una librería
 * entera (la de npm más conocida, `xlsx`, quedó sin parches de seguridad).
 *
 * Qué sale: la primera fila en negrilla y fija al hacer scroll, números como
 * NÚMEROS (se pueden sumar en Excel; con 2 decimales), textos tal cual y
 * columnas con un ancho razonable. El zip va sin comprimir (método «store»):
 * Excel, LibreOffice y Google Sheets lo abren igual.
 *
 * Corre en el navegador y en Node (solo usa TextEncoder y Uint8Array).
 */

// ── Zip mínimo (store) ────────────────────────────────────────────────────
const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Zip sin comprimir de [{ nombre, datos: Uint8Array }]. */
export function zipAlmacenado(archivos) {
  const enc = new TextEncoder()
  const partes = []
  const central = []
  let desplazamiento = 0
  // Fecha fija (1/1/2024 00:00, formato DOS): el contenido no depende de ella.
  const HORA = 0
  const FECHA = ((2024 - 1980) << 9) | (1 << 5) | 1
  for (const { nombre, datos } of archivos) {
    const n = enc.encode(nombre)
    const crc = crc32(datos)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // versión necesaria
    local.setUint16(6, 0x0800, true) // nombres en UTF-8
    local.setUint16(8, 0, true) // método: store
    local.setUint16(10, HORA, true)
    local.setUint16(12, FECHA, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, datos.length, true)
    local.setUint32(22, datos.length, true)
    local.setUint16(26, n.length, true)
    local.setUint16(28, 0, true)
    partes.push(new Uint8Array(local.buffer), n, datos)

    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(8, 0x0800, true)
    cd.setUint16(10, 0, true)
    cd.setUint16(12, HORA, true)
    cd.setUint16(14, FECHA, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, datos.length, true)
    cd.setUint32(24, datos.length, true)
    cd.setUint16(28, n.length, true)
    cd.setUint32(42, desplazamiento, true)
    central.push(new Uint8Array(cd.buffer), n)
    desplazamiento += 30 + n.length + datos.length
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0)
  const fin = new DataView(new ArrayBuffer(22))
  fin.setUint32(0, 0x06054b50, true)
  fin.setUint16(8, archivos.length, true)
  fin.setUint16(10, archivos.length, true)
  fin.setUint32(12, tamCentral, true)
  fin.setUint32(16, desplazamiento, true)
  const todo = [...partes, ...central, new Uint8Array(fin.buffer)]
  const salida = new Uint8Array(todo.reduce((s, p) => s + p.length, 0))
  let i = 0
  for (const p of todo) { salida.set(p, i); i += p.length }
  return salida
}

// ── La hoja ───────────────────────────────────────────────────────────────
/** XML seguro: escapa y quita los caracteres de control que XML no admite. */
const esc = (s) => String(s)
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Índice de columna (0) → letra de Excel (A … Z, AA …). */
export const letraColumna = (i) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/**
 * Estilos con nombre para las celdas: una celda puede ser un valor suelto o
 * `{ v, e }`, con `e` uno de estos. Los índices son los de <cellXfs>.
 */
const ESTILOS = { normal: 0, encabezado: 1, decimal: 2, entrada: 3, salida: 4, nombre: 5, vacio: 0 }

/**
 * El XML de una hoja: encabezado con los colores de la marca y fijo, bordes
 * suaves, números como números.
 * @param {{ columnasFijas?: number }} [opciones]  columnas fijas a la izquierda al hacer scroll
 */
function hojaXml(filas, { columnasFijas = 0 } = {}) {
  const celda = (bruto, r, c) => {
    const ref = `${letraColumna(c)}${r + 1}`
    const { v, e } = bruto !== null && typeof bruto === 'object' ? bruto : { v: bruto }
    const vacio = v === null || v === undefined || v === ''
    // Una celda vacía CON estilo se escribe igual: así el bloque de color
    // del colaborador y la cuadrícula del día salen continuos.
    if (vacio && !e) return ''
    let estilo = r === 0 ? 1 : (e ? ESTILOS[e] ?? 0 : 0)
    if (vacio) return `<c r="${ref}"${estilo ? ` s="${estilo}"` : ''}/>`
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (r > 0 && !e && !Number.isInteger(v)) estilo = 2
      return `<c r="${ref}"${estilo ? ` s="${estilo}"` : ''}><v>${v}</v></c>`
    }
    return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`
  }
  const texto = (x) => String((x !== null && typeof x === 'object' ? x.v : x) ?? '')
  const columnas = Math.max(0, ...filas.map((f) => f.length))
  const anchos = Array.from({ length: columnas }, (_, c) => {
    const largo = Math.max(...filas.map((f) => texto(f[c]).length))
    return Math.min(45, Math.max(10, largo + 3))
  })
  const fijas = columnasFijas > 0
  const panel = fijas
    ? `<pane xSplit="${columnasFijas}" ySplit="1" topLeftCell="${letraColumna(columnasFijas)}2" activePane="bottomRight" state="frozen"/>`
    : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetViews><sheetView workbookViewId="0" showGridLines="0">${panel}</sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="18" customHeight="1"/>'
    + (anchos.length ? `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '')
    + '<sheetData>'
    + filas.map((f, r) => `<row r="${r + 1}"${r === 0 ? ' ht="26" customHeight="1"' : ''}>${f.map((v, c) => celda(v, r, c)).join('')}</row>`).join('')
    + '</sheetData></worksheet>'
}

/**
 * Nombres de hoja válidos para Excel: sin \ / ? * [ ] :, máximo 31
 * caracteres y SIN repetirse (dos «Ana María» serían un libro dañado).
 */
function nombresDeHoja(nombres) {
  const usados = new Set()
  return nombres.map((n, i) => {
    const base = String(n ?? '').replace(/[\/?*[\]:]/g, ' ').trim().slice(0, 31) || `Hoja${i + 1}`
    let nombre = base
    for (let k = 2; usados.has(nombre.toLowerCase()); k++) nombre = `${base.slice(0, 31 - String(k).length - 1)} ${k}`
    usados.add(nombre.toLowerCase())
    return nombre
  })
}

/**
 * Libro de VARIAS hojas.
 * @param {Array<{ nombre: string, filas: Array<Array<any>>, columnasFijas?: number }>} hojas
 *   cada celda es un valor o `{ v, e }` con `e` un nombre de ESTILOS
 * @returns {Uint8Array} el .xlsx
 */
export function crearLibro(hojas) {
  const enc = new TextEncoder()
  const x = (s) => enc.encode(s)
  const nombres = nombresDeHoja(hojas.map((h) => h.nombre))
  return zipAlmacenado([
    { nombre: '[Content_Types].xml', datos: x('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>') },
    { nombre: '_rels/.rels', datos: x('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>') },
    { nombre: 'xl/workbook.xml', datos: x('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets>${nombres.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: x('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>') },
    { nombre: 'xl/styles.xml', datos: x('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      // Colores de la marca: marino para el encabezado; verde para entradas
      // y naranja para salidas (los mismos del cajón de marcaciones).
      + '<fonts count="5">'
      + '<font><sz val="11"/><color rgb="FF14233A"/><name val="Calibri"/></font>'
      + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
      + '<font><b/><sz val="11"/><color rgb="FF13294B"/><name val="Calibri"/></font>'
      + '<font><sz val="11"/><color rgb="FF1B6B4F"/><name val="Calibri"/></font>'
      + '<font><sz val="11"/><color rgb="FF9A4B12"/><name val="Calibri"/></font>'
      + '</fonts>'
      + '<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
      + '<fill><patternFill patternType="solid"><fgColor rgb="FF13294B"/><bgColor indexed="64"/></patternFill></fill>'
      + '<fill><patternFill patternType="solid"><fgColor rgb="FFE3F5EE"/><bgColor indexed="64"/></patternFill></fill>'
      + '<fill><patternFill patternType="solid"><fgColor rgb="FFFDEBD9"/><bgColor indexed="64"/></patternFill></fill>'
      + '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F8"/><bgColor indexed="64"/></patternFill></fill>'
      + '</fills>'
      + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
      + '<border><left style="thin"><color rgb="FFD5DEEA"/></left><right style="thin"><color rgb="FFD5DEEA"/></right>'
      + '<top style="thin"><color rgb="FFD5DEEA"/></top><bottom style="thin"><color rgb="FFD5DEEA"/></bottom><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      // 0 normal · 1 encabezado · 2 decimal · 3 entrada · 4 salida · 5 nombre (ver ESTILOS).
      + '<cellXfs count="6">'
      + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="center"/></xf>'
      + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
      + '<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"><alignment vertical="center"/></xf>'
      + '<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
      + '<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
      + '<xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
      + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>') },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: x(hojaXml(h.filas, h)) })),
  ])
}

/**
 * Libro de UNA hoja.
 * @param {Array<Array<string|number|null|undefined>>} filas  la primera es el encabezado
 * @param {{ hoja?: string }} [opciones]
 * @returns {Uint8Array} el .xlsx
 */
export function crearXlsx(filas, { hoja = 'Reporte' } = {}) {
  return crearLibro([{ nombre: hoja, filas }])
}
