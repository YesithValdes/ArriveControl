package co.asistencia.kiosco

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import java.nio.FloatBuffer
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Descriptor facial v2 (ArcFace w600k_mbf, 512 floats normalizados L2).
 *
 * PORTE LÍNEA POR LÍNEA de attendance-prototype/lib/rostroV2.js. Tiene que dar
 * el MISMO vector que la web para la misma cara: si no, los rostros ya
 * registrados dejarían de parecerse y habría que registrar a todos otra vez.
 * Cualquier cambio aquí se valida con la pantalla de prueba de compatibilidad.
 *
 *  1. 5 puntos (ojos, nariz, comisuras) desde los landmarks de MediaPipe,
 *     con los MISMOS índices que puntos5DeMediaPipe.
 *  2. Semejanza de Umeyama (rotación + escala + traslación) hacia la
 *     plantilla ArcFace, y se dibuja la imagen en un lienzo de 112×112.
 *  3. NCHW, RGB, (x − 127.5) / 127.5.
 *  4. Normalizado L2: la similitud coseno es un producto punto.
 */
class Rostro(context: Context) : AutoCloseable {
    companion object {
        const val LARGO = 512
        const val LADO = 112

        // Plantilla ArcFace (lib/rostroV2.js: PLANTILLA). «Izquierda» es la de la IMAGEN.
        private val PLANTILLA = arrayOf(
            floatArrayOf(38.2946f, 51.6963f),
            floatArrayOf(73.5318f, 51.5014f),
            floatArrayOf(56.0252f, 71.7366f),
            floatArrayOf(41.5493f, 92.3655f),
            floatArrayOf(70.7299f, 92.2041f),
        )

        // Índices de la malla de MediaPipe (lib/rostroV2.js: puntos5DeMediaPipe).
        private val OJO_IZQ = intArrayOf(33, 160, 158, 133, 153, 144)
        private val OJO_DER = intArrayOf(362, 385, 387, 263, 373, 380)
        private const val NARIZ = 1
        private const val BOCA_IZQ = 61
        private const val BOCA_DER = 291

        /** Los 5 puntos en PÍXELES de la imagen (landmarks normalizados 0..1). */
        fun puntos5(lm: List<NormalizedLandmark>, ancho: Int, alto: Int): Array<FloatArray> {
            fun px(i: Int) = floatArrayOf(lm[i].x() * ancho, lm[i].y() * alto)
            fun centro(idx: IntArray): FloatArray {
                var sx = 0f; var sy = 0f
                for (i in idx) { sx += lm[i].x(); sy += lm[i].y() }
                return floatArrayOf(sx / idx.size * ancho, sy / idx.size * alto)
            }
            return arrayOf(centro(OJO_IZQ), centro(OJO_DER), px(NARIZ), px(BOCA_IZQ), px(BOCA_DER))
        }

        /**
         * Semejanza de Umeyama src → dst (lib/rostroV2.js: semejanzaUmeyama).
         * Devuelve [a, b, e, f]: x' = a·x − b·y + e ; y' = b·x + a·y + f.
         */
        fun umeyama(src: Array<FloatArray>, dst: Array<FloatArray>): FloatArray {
            val n = src.size
            var mxS = 0.0; var myS = 0.0; var mxD = 0.0; var myD = 0.0
            for (i in 0 until n) { mxS += src[i][0]; myS += src[i][1]; mxD += dst[i][0]; myD += dst[i][1] }
            mxS /= n; myS /= n; mxD /= n; myD /= n
            var sxx = 0.0; var sxy = 0.0; var syx = 0.0; var syy = 0.0; var varS = 0.0
            for (i in 0 until n) {
                val xs = src[i][0] - mxS; val ys = src[i][1] - myS
                val xd = dst[i][0] - mxD; val yd = dst[i][1] - myD
                sxx += xs * xd; sxy += xs * yd; syx += ys * xd; syy += ys * yd
                varS += xs * xs + ys * ys
            }
            val theta = atan2(sxy - syx, sxx + syy)
            val c = cos(theta); val s = sin(theta)
            val escala = (c * (sxx + syy) + s * (sxy - syx)) / varS
            val a = escala * c; val b = escala * s
            val e = mxD - (a * mxS - b * myS)
            val f = myD - (b * mxS + a * myS)
            return floatArrayOf(a.toFloat(), b.toFloat(), e.toFloat(), f.toFloat())
        }

        /** Similitud coseno entre descriptores YA normalizados. */
        fun similitud(a: FloatArray, b: FloatArray): Float {
            var s = 0f
            for (i in 0 until LARGO) s += a[i] * b[i]
            return s
        }

        /** Promedio re-normalizado (lib/rostroV2.js: promedioV2). */
        fun promedio(lista: List<FloatArray>): FloatArray {
            if (lista.size == 1) return lista[0]
            val suma = FloatArray(LARGO)
            for (v in lista) for (i in 0 until LARGO) suma[i] += v[i]
            return normalizar(suma)
        }

        private fun normalizar(v: FloatArray): FloatArray {
            var n = 0.0
            for (x in v) n += x * x
            val norma = sqrt(n).toFloat().takeIf { it > 0f } ?: 1f
            return FloatArray(v.size) { v[it] / norma }
        }
    }

    private val env = OrtEnvironment.getEnvironment()
    private val sesion: OrtSession = env.createSession(
        context.assets.open("modelos/v2/w600k_mbf.onnx").use { it.readBytes() },
        OrtSession.SessionOptions(),
    )
    private val entradaNombre = sesion.inputNames.first()

    // Lienzo y buffers reusados: se calcula varias veces por segundo.
    private val lienzo = Bitmap.createBitmap(LADO, LADO, Bitmap.Config.ARGB_8888)
    private val pixeles = IntArray(LADO * LADO)
    // Muestreo bilineal, como drawImage del canvas del navegador.
    private val pintura = Paint(Paint.FILTER_BITMAP_FLAG)

    init {
        // Primera inferencia en vacío (igual que la web): el costo de arranque
        // se paga aquí y no en la primera persona.
        runCatching { calcular(FloatArray(3 * LADO * LADO)) }
    }

    /**
     * Descriptor de una imagen DERECHA y SIN espejo (como el video crudo del
     * navegador), con los 5 puntos en píxeles de esa misma imagen.
     */
    @Synchronized
    fun descriptor(imagen: Bitmap, puntos: Array<FloatArray>): FloatArray {
        val (a, b, e, f) = umeyama(puntos, PLANTILLA).let { listOf(it[0], it[1], it[2], it[3]) }
        // canvas.setTransform(a, b, −b, a, e, f) de la web, en la matriz de Android:
        // x' = a·x + (−b)·y + e ; y' = b·x + a·y + f
        val m = Matrix().apply { setValues(floatArrayOf(a, -b, e, b, a, f, 0f, 0f, 1f)) }
        lienzo.eraseColor(0) // fuera de la imagen: negro transparente, como el canvas
        Canvas(lienzo).drawBitmap(imagen, m, pintura)
        lienzo.getPixels(pixeles, 0, LADO, 0, 0, LADO, LADO)

        val plano = LADO * LADO
        val entrada = FloatArray(3 * plano)
        for (i in 0 until plano) {
            val p = pixeles[i]
            entrada[i] = (((p shr 16) and 0xff) - 127.5f) / 127.5f // R
            entrada[plano + i] = (((p shr 8) and 0xff) - 127.5f) / 127.5f // G
            entrada[2 * plano + i] = ((p and 0xff) - 127.5f) / 127.5f // B
        }
        return normalizar(calcular(entrada))
    }

    private fun calcular(entrada: FloatArray): FloatArray {
        OnnxTensor.createTensor(env, FloatBuffer.wrap(entrada), longArrayOf(1, 3, LADO.toLong(), LADO.toLong())).use { t ->
            sesion.run(mapOf(entradaNombre to t)).use { r ->
                @Suppress("UNCHECKED_CAST")
                val salida = (r[0].value as Array<FloatArray>)[0]
                return salida.copyOf(LARGO)
            }
        }
    }

    override fun close() {
        sesion.close()
    }
}
