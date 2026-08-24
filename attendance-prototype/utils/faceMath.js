/**
 * utils/faceMath.js
 * Lógica de comparación vectorial entre embeddings faciales (128 floats).
 * La comparación se hace con Distancia Euclidiana. Sin dependencias.
 */

/** Longitud esperada del descriptor que produce face-api.js */
export const EMBEDDING_LENGTH = 128;

/**
 * Umbral de coincidencia: distancias menores a este valor se consideran
 * la misma persona. 0.5 es estricto (prioriza NO aceptar impostores, que en
 * asistencia es el error grave). Afinar con los datos FAR/FRR del piloto:
 * si nadie legítimo es rechazado, se puede probar 0.45.
 */
export const MATCH_THRESHOLD = 0.5;

/**
 * Margen mínimo entre el PRIMER y el SEGUNDO candidato para dar por buena una
 * identificación 1:N. Parecerse al más cercano no basta: hay que parecerse
 * claramente MÁS que al siguiente.
 *
 * Nace de un caso real: dos empleadas con rostros vecinos (0.548 entre sus
 * fotos de registro), y la cara de una cayó a 0.494 de la otra — dentro del
 * umbral — ganando por milésimas. El sistema lo trató como certeza y registró
 * la asistencia en la persona equivocada.
 *
 * Bajar `MATCH_THRESHOLD` no era la salida: con los descriptores actuales
 * (rostros apiñados por fotos de baja calidad), 0.45 habría rechazado el 38%
 * de las marcaciones legítimas. El margen es selectivo — solo frena los
 * empates, que son exactamente los casos donde el sistema no sabe.
 */
export const MARGEN_MINIMO = 0.10;

/**
 * Valida que el valor sea un vector numérico de 128 posiciones.
 * Acepta Array o Float32Array (face-api devuelve Float32Array).
 */
export function isValidEmbedding(vector) {
  return (
    (Array.isArray(vector) || vector instanceof Float32Array) &&
    vector.length === EMBEDDING_LENGTH &&
    Array.from(vector).every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/**
 * Distancia Euclidiana: sqrt(sum((a[i] - b[i])^2))
 * @param {number[]|Float32Array} a
 * @param {number[]|Float32Array} b
 * @returns {number}
 */
export function euclideanDistance(a, b) {
  if (!isValidEmbedding(a) || !isValidEmbedding(b)) {
    throw new Error(
      `Ambos embeddings deben ser vectores numéricos de ${EMBEDDING_LENGTH} floats.`
    );
  }
  let sum = 0;
  for (let i = 0; i < EMBEDDING_LENGTH; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Compara dos embeddings y decide si son la misma persona.
 * @returns {{ isMatch: boolean, distance: number, threshold: number }}
 */
export function compareFaces(referenceEmbedding, liveEmbedding) {
  const distance = euclideanDistance(referenceEmbedding, liveEmbedding);
  return {
    isMatch: distance < MATCH_THRESHOLD,
    distance: Math.round(distance * 10000) / 10000,
    threshold: MATCH_THRESHOLD,
  };
}
