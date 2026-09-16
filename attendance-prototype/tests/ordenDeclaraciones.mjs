/**
 * Detector de «Cannot access 'x' before initialization» en un componente.
 *
 * En un componente de miles de líneas, un `useEffect(..., [cfg.periodoPago])`
 * colocado diez líneas ANTES de `const [cfg] = useState(...)` compila sin
 * queja (Next no renderiza páginas dinámicas al construir) y revienta en el
 * navegador de todo el mundo: pantalla en blanco con «Application error».
 *
 * La revisión es estática y aproximada, pero certera para lo que importa:
 * dentro del cuerpo del componente (hasta su `return (`), todo lo que se
 * evalúa DURANTE el render —sentencias del nivel superior, arreglos de
 * dependencias, el cuerpo de un useMemo o el inicializador de un useState—
 * no puede nombrar una constante del componente declarada más abajo. Lo que
 * va dentro de una función (useEffect, manejadores, useCallback) se ejecuta
 * después y no cuenta.
 */

/**
 * Deja el texto con el mismo largo y los mismos saltos de línea, pero con
 * comentarios y cadenas en blanco (las plantillas `…` enteras, con sus
 * `${}`), para que ni un «roster» en un comentario ni un «cfg» en un texto
 * se tomen por código.
 */
function blanquear(texto) {
  let salida = '';
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    const dos = texto.slice(i, i + 2);
    if (dos === '//') {
      while (i < n && texto[i] !== '\n') { salida += ' '; i++; }
    } else if (dos === '/*') {
      while (i < n && texto.slice(i, i + 2) !== '*/') { salida += texto[i] === '\n' ? '\n' : ' '; i++; }
      salida += '  '; i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      salida += c; i++;
      while (i < n && texto[i] !== c) {
        if (texto[i] === '\\') { salida += '  '; i += 2; continue; }
        salida += texto[i] === '\n' ? '\n' : ' '; i++;
      }
      salida += c; i++;
    } else {
      salida += c; i++;
    }
  }
  return salida;
}

/** Nombres que declara una línea `const|let|var …` (incluye desestructuración). */
function nombresDeclarados(codigo) {
  const m = codigo.match(/^\s*(?:const|let|var)\s+(.+?)\s*=(?!=)/);
  if (!m) return [];
  const izq = m[1].trim();
  if (!/^[[{]/.test(izq)) return [izq];
  return izq
    .slice(1, -1)
    .split(',')
    .map((p) => p.trim().replace(/^\.\.\./, '').replace(/^[\w$]+\s*:\s*/, '').replace(/\s*=.*$/, ''))
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
}

/**
 * @param {string} fuente  el archivo completo
 * @param {string} componente  nombre de la función (`export default function X`)
 * @returns {{ nombre: string, linea: number, declarada: number }[]}
 */
export function usosAntesDeDeclarar(fuente, componente) {
  const lineas = blanquear(fuente).split('\n');
  const inicio = lineas.findIndex((l) => new RegExp(`^export default function ${componente}\\b`).test(l));
  if (inicio < 0) throw new Error(`no se encontró el componente ${componente}`);
  let fin = lineas.findIndex((l, i) => i > inicio && /^  return \(/.test(l));
  if (fin < 0) fin = lineas.findIndex((l, i) => i > inicio && l === '}');

  // 1) Declaraciones del nivel superior del componente (dos espacios).
  const declaradaEn = new Map();
  for (let i = inicio + 1; i < fin; i++) {
    if (!/^  (?:const|let|var) /.test(lineas[i])) continue;
    for (const n of nombresDeclarados(lineas[i])) if (!declaradaEn.has(n)) declaradaEn.set(n, i);
  }

  // 2) Recorrido carácter a carácter con una pila de aperturas: 'fn' = cuerpo
  //    de una función (diferido), 'sync' = cualquier otro paréntesis o llave.
  //    Una flecha sin llaves (`() => abrir()`) difiere el resto de su
  //    expresión hasta la coma o el cierre del mismo nivel. El callback de
  //    useMemo y el inicializador de useState corren en el render: 'sync'.
  const pila = [];
  let flechaSinLlaves = null; // profundidad de la pila donde empezó
  const hallazgos = [];
  let inicioSentencia = inicio + 1;
  for (let i = inicio + 1; i < fin; i++) {
    const codigo = lineas[i];
    if (/^  \S/.test(codigo)) inicioSentencia = i;
    const esHookSync = /\buse(?:Memo|State)\s*\(/.test(codigo);

    // Lo que se evalúa en el render, con lo diferido en blanco.
    let sync = '';
    for (let k = 0; k < codigo.length; k++) {
      const c = codigo[k];
      const diferido = pila.includes('fn') || flechaSinLlaves !== null;
      if (c === '{' || c === '(') {
        const antes = codigo.slice(0, k).trimEnd();
        const abreFn = /=>$/.test(antes) || /\bfunction\b[^(]*\([^)]*\)$/.test(antes);
        sync += diferido ? ' ' : c;
        pila.push(abreFn && !esHookSync ? 'fn' : 'sync');
      } else if (c === '}' || c === ')') {
        sync += diferido ? ' ' : c;
        pila.pop();
        if (flechaSinLlaves !== null && pila.length < flechaSinLlaves) flechaSinLlaves = null;
      } else if ((c === ',' || c === ';') && flechaSinLlaves !== null && pila.length === flechaSinLlaves) {
        flechaSinLlaves = null;
        sync += c;
      } else if (codigo.slice(k, k + 2) === '=>' && !diferido && !esHookSync) {
        const despues = codigo.slice(k + 2).trimStart();
        if (despues && !/^[{(]/.test(despues)) flechaSinLlaves = pila.length;
        sync += '  '; k++;
      } else {
        sync += diferido ? ' ' : c;
      }
    }
    if (flechaSinLlaves !== null && pila.length === flechaSinLlaves && !/[,;(]\s*$/.test(codigo)) flechaSinLlaves = null;

    if (!sync.trim()) continue;
    const sinClaves = sync.replace(/(?<=[{,(]\s*)[A-Za-z_$][\w$]*\s*:(?!:)/g, ' ');
    const usados = new Set(sinClaves.match(/(?<![.\w$])[A-Za-z_$][\w$]*/g) ?? []);
    for (const n of usados) {
      const d = declaradaEn.get(n);
      if (d === undefined || d <= i) continue;
      // ¿Lo declara localmente la sentencia en curso (un `const` interno, un
      // parámetro, la variable de un for)? Entonces es otro «n».
      const local = lineas.slice(inicioSentencia, i + 1).some((l) => (
        nombresDeclarados(l).includes(n)
        || new RegExp(`\\(([^()]*,\\s*)?${n}\\s*[,)=]`).test(l)
        || new RegExp(`(?<![.\\w$])${n}\\s*=>`).test(l)
        || new RegExp(`for\\s*\\(\\s*(?:const|let)\\s+(?:\\[[^\\]]*\\b${n}\\b[^\\]]*\\]|${n})\\b`).test(l)
      ));
      if (!local) hallazgos.push({ nombre: n, linea: i + 1, declarada: d + 1 });
    }
  }
  return hallazgos;
}
