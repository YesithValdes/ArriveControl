/**
 * lib/gestor.js — Todo lo que ArriveControl necesita del gestor de nómina,
 * pedido por HTTP (solo servidor).
 *
 * Antes esto eran JOINs a `public.colaborador` porque compartían base de
 * datos. Ya no: son dos productos separados, cada uno dueño de sus tablas.
 * Esta es la única puerta, y solo se abre en MODO CONECTADO.
 */
import { modoConectado } from './configLaboral.js'

const TTL_ESTADOS_MS = 60 * 1000 // los retiros no son urgentes al segundo

/** @type {{ datos: Map<string, boolean>, expira: number } | null} */
let cacheEstados = null

function baseYClave() {
  const base = (process.env.GESTOR_URL ?? '').replace(/\/$/, '')
  const clave = process.env.INTEGRACION_HORAS_API_KEY ?? ''
  return { base, clave }
}

async function pedir(ruta) {
  const { base, clave } = baseYClave()
  const res = await fetch(`${base}/api/integraciones/colaboradores${ruta}`, {
    headers: { 'X-API-Key': clave },
    cache: 'no-store',
  })
  const texto = await res.text()
  let datos = null
  try { datos = JSON.parse(texto) } catch { /* no era JSON */ }
  if (!res.ok || !datos?.ok) {
    throw new Error(datos?.error ?? `El gestor respondió ${res.status}.`)
  }
  return datos
}

/**
 * Busca colaboradores activos del gestor para registrarlos en asistencia.
 * @returns {Promise<Array<{id, nombres, apellidos, cedula, sede_gestor, tiene_foto}>>}
 */
export async function buscarColaboradores(texto) {
  if (!modoConectado()) return []
  const q = String(texto ?? '').trim()
  if (q.length < 2) return []
  return (await pedir(`?buscar=${encodeURIComponent(q.toLowerCase())}`)).colaboradores ?? []
}

/**
 * Datos de UN colaborador por su id, para validar el alta.
 * @returns {Promise<object|null>} null si no existe o no está activo.
 */
export async function colaboradorPorId(id) {
  if (!modoConectado()) return null
  return (await pedir(`?id=${encodeURIComponent(String(id))}`)).colaborador ?? null
}

/**
 * ¿Qué cédulas siguen ACTIVAS en el gestor? Con caché corta: se usa en cada
 * descarga del roster del kiosco, y un retiro puede tardar un minuto en
 * reflejarse sin consecuencias.
 *
 * Si el gestor no responde, devuelve null y quien llama decide: preferimos
 * no bloquear el kiosco por una caída de la nómina.
 * @returns {Promise<Map<string, boolean> | null>} cédula → activo
 */
export async function estadosDeColaboradores(cedulas) {
  if (!modoConectado() || cedulas.length === 0) return null
  const ahora = Date.now()
  if (cacheEstados && ahora < cacheEstados.expira) return cacheEstados.datos
  try {
    const { colaboradores: filas = [] } = await pedir(`?documentos=${cedulas.map(encodeURIComponent).join(',')}`)
    const datos = new Map(filas.map((c) => [c.cedula, c.activo]))
    cacheEstados = { datos, expira: ahora + TTL_ESTADOS_MS }
    return datos
  } catch (e) {
    if (cacheEstados) return cacheEstados.datos // último-bueno
    console.error('No se pudo consultar el estado de los colaboradores:', e.message)
    return null
  }
}
