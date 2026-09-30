package co.asistencia.kiosco

import android.graphics.Bitmap
import android.util.Log
import kotlin.math.abs
import kotlin.math.max

// ── Reglas del kiosco web (components/KioskMode.jsx y utils/faceMath.js) ──
const val UMBRAL = 0.45f // similitud mínima para aceptar
const val MARGEN = 0.08f // ventaja mínima del 1º sobre el 2º
private const val INTERVALO_RETO_MS = 66L // ~15 fps: un parpadeo dura 100–150 ms
private const val INTERVALO_REPOSO_MS = 330L // ~3 fps: solo vigila presencia
private const val PLAZO_RETO_MS = 12_000L // tiempo máx. para el parpadeo
const val RESULTADO_MS = 1_500L // cuánto se ve el resultado
private const val PAUSA_MS = 700L // pausa tras cada validación
private const val CAPTURAS = 2 // capturas de identidad por validación
private const val SEPARACION_CAPTURAS_MS = 450L

enum class Fase { REPOSO, RETO, RESULTADO, PAUSA }
enum class Encuadre { OK, LEJOS, CERCA }

/** Lo que se muestra al terminar una validación. */
sealed class Resultado {
    data class Registrando(val nombre: String) : Resultado()
    data class Marcado(val nombre: String, val entrada: Boolean, val hora: String, val trabajadoSeg: Long?) : Resultado()
    data class YaRegistrada(val nombre: String, val tipo: String, val hora: String) : Resultado()
    data class Pendiente(val nombre: String) : Resultado()
    data class Prueba(val nombre: String, val sim: Float) : Resultado()
    data class Rechazo(val motivo: String, val nombre: String? = null) : Resultado()
}

data class Vista(
    val fase: Fase = Fase.REPOSO,
    val encuadre: Encuadre = Encuadre.OK,
    /** Avance REAL del reto: 25 cara · 50 un estado de ojos · 75 parpadeo · 100 resuelto. */
    val progreso: Int = 0,
    val resultado: Resultado? = null,
    val diagnostico: String = "",
)

/** Métricas del intento (escalares, sin biometría) para la telemetría. */
data class Metricas(val v2Mejor: Float?, val v2Segundo: Float?)

/**
 * La máquina de estados del reconocimiento, como la de la web:
 *   REPOSO → (aparece una cara) → RETO → (parpadeo + identidad) → RESULTADO → PAUSA → REPOSO
 *
 * Corre en el hilo de análisis de la cámara ([cuadro]); la marcación en red
 * la hace quien la usa, a través de [alConcluir], y devuelve lo que pasó con
 * [mostrar]. Una instancia por arranque: al detener se descarta.
 */
class Motor(
    private val detector: Detector,
    private val rostro: Rostro,
    private val candidatos: () -> List<Persona>,
    private val sedeKiosco: () -> String?,
    private val alIniciarReto: () -> Unit,
    /** ok=true con la persona reconocida; ok=false con el motivo (y quién, si fue por sede). */
    private val alConcluir: (ok: Boolean, persona: Persona?, motivo: String?, metricas: Metricas, sim: Float) -> Unit,
    private val publicar: (Vista) -> Unit,
) {
    private var fase = Fase.REPOSO
    private var ultimoAnalisis = 0L
    private var plazo = 0L
    private var hasta = 0L
    private var vioAbiertos = false
    private var vioCerrados = false
    private val capturas = mutableListOf<FloatArray>()
    private var ultimaCaptura = 0L
    private var reintento = false
    private var ultimoOk: Boolean? = null
    private var resultado: Resultado? = null
    private var progreso = 0
    private var encuadre = Encuadre.OK
    private var t0 = 0L

    @Synchronized
    fun cuadro(img: Bitmap, ahora: Long) {
        val intervalo = if (fase == Fase.RETO) INTERVALO_RETO_MS else INTERVALO_REPOSO_MS
        if (ahora - ultimoAnalisis < intervalo) return
        ultimoAnalisis = ahora

        val c = detector.analizar(img)
        val lm = c.landmarks
        when (fase) {
            Fase.REPOSO -> if (lm != null) {
                fase = Fase.RETO
                plazo = ahora + PLAZO_RETO_MS
                vioAbiertos = false; vioCerrados = false
                capturas.clear(); ultimaCaptura = 0; reintento = false
                resultado = null; progreso = 25; t0 = ahora
                alIniciarReto() // que el GPS vaya llegando
            }
            Fase.RETO -> reto(img, c, ahora)
            Fase.RESULTADO -> if (resultado !is Resultado.Registrando && ahora > hasta) {
                fase = Fase.PAUSA; hasta = ahora + PAUSA_MS
            }
            // Tras un registro exitoso se exige que la cara se retire (no se
            // re-escanea a quien ya marcó); tras un rechazo se puede reintentar de una.
            Fase.PAUSA -> if (ahora > hasta && (lm == null || ultimoOk == false)) {
                fase = Fase.REPOSO; resultado = null; progreso = 0; encuadre = Encuadre.OK
            }
        }
        emitir()
    }

    private fun reto(img: Bitmap, c: Cuadro, ahora: Long) {
        val lm = c.landmarks
        if (lm == null) { fase = Fase.REPOSO; progreso = 0; encuadre = Encuadre.OK; return }
        if (ahora > plazo) { concluir(false, null, "No se detectó el parpadeo.", Metricas(null, null), -1f, ahora); return }

        // Encuadre: solo los EXTREMOS frenan (muy lejos no hay píxeles para
        // reconocer; muy cerca la cara se sale del cuadro). Mismos límites que la web.
        var minY = 1f; var maxY = 0f
        for (p in lm) { if (p.y() < minY) minY = p.y(); if (p.y() > maxY) maxY = p.y() }
        val alto = maxY - minY
        encuadre = if (alto < 0.22f) Encuadre.LEJOS else if (alto > 0.85f) Encuadre.CERCA else Encuadre.OK
        if (encuadre != Encuadre.OK) { progreso = 25; return }

        // Prueba de vida SIN orden: ojos razonablemente abiertos en algún
        // momento y un cierre (aunque sea parcial) en otro. Una foto no se mueve.
        if (c.ambosAbiertos < 0.25f) vioAbiertos = true
        if (c.ambosCerrados > 0.35f) vioCerrados = true
        progreso = if (vioAbiertos && vioCerrados) 75 else if (vioAbiertos || vioCerrados) 50 else 25

        // Capturas de identidad: solo DE FRENTE, separadas en el tiempo.
        if (abs(c.yaw) < 12f && capturas.size < CAPTURAS && ahora - ultimaCaptura >= SEPARACION_CAPTURAS_MS) {
            ultimaCaptura = ahora
            runCatching { capturas += rostro.descriptor(img, Rostro.puntos5(lm, img.width, img.height)) }
                .onFailure { Log.w("Kiosco", "captura fallida", it) }
        }

        if (vioAbiertos && vioCerrados && capturas.isNotEmpty()) decidir(ahora)
    }

    private fun decidir(ahora: Long) {
        val vivo = Rostro.promedio(capturas)
        // Por persona gana su rostro MÁS parecido (nunca el promedio de los suyos).
        val ranking = candidatos().filter { it.rostrosV2.isNotEmpty() }
            .map { p -> p to p.rostrosV2.maxOf { Rostro.similitud(it, vivo) } }
            .sortedByDescending { it.second }
        val (ganador, sim) = ranking.firstOrNull() ?: (null to -1f)
        val segundo = ranking.getOrNull(1)?.second
        val ambiguo = segundo != null && sim - segundo < MARGEN
        val reconocido = ganador != null && sim >= UMBRAL && !ambiguo
        val metricas = Metricas(sim.takeIf { it >= 0 }, segundo)
        Log.i("Kiosco", "decide a los ${ahora - t0} ms: 1º ${ganador?.nombre} ${"%.3f".format(sim)} · 2º ${ranking.getOrNull(1)?.first?.nombre} ${segundo?.let { "%.3f".format(it) }} · ${if (reintento) "reintento" else "primer intento"}")

        // REINTENTO SILENCIOSO: la prueba de vida ya está hecha; se descartan
        // las capturas (pudieron salir movidas) y se mide de cero una vez más.
        if (!reconocido && !reintento) {
            reintento = true
            capturas.clear(); ultimaCaptura = 0
            plazo = max(plazo, ahora + 4_000)
            return
        }
        // Sede exigida: con «validar sede», solo marca en un kiosco de SU sede.
        val sedeAjena = reconocido && ganador!!.validarSede && ganador.sedeId != null && ganador.sedeId != sedeKiosco()
        val ok = reconocido && !sedeAjena
        val motivo = when {
            ok -> null
            sedeAjena -> "Debes marcar en el kiosco de tu sede asignada."
            ambiguo -> "No pudimos distinguirte con seguridad. Acércate un poco más e intenta de nuevo."
            else -> "Intenta de nuevo mirando de frente."
        }
        concluir(ok, if (reconocido) ganador else null, motivo, metricas, sim, ahora)
    }

    private fun concluir(ok: Boolean, persona: Persona?, motivo: String?, m: Metricas, sim: Float, ahora: Long) {
        fase = Fase.RESULTADO
        ultimoOk = ok
        progreso = 100
        encuadre = Encuadre.OK
        hasta = ahora + RESULTADO_MS
        resultado = if (ok) Resultado.Registrando(persona!!.nombre) else Resultado.Rechazo(motivo ?: "Intenta de nuevo.", persona?.nombre)
        alConcluir(ok, persona, motivo, m, sim)
    }

    /** Lo que resultó de la marcación (lo llama quien la hizo, desde otro hilo). */
    @Synchronized
    fun mostrar(r: Resultado) {
        if (fase != Fase.RESULTADO) return
        resultado = r
        hasta = System.currentTimeMillis() + RESULTADO_MS
        if (r is Resultado.Rechazo) ultimoOk = false
        emitir()
    }

    private fun emitir() = publicar(Vista(fase, encuadre, progreso, resultado))
}
