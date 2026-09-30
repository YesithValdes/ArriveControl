package co.asistencia.kiosco

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min

/** Lo que MediaPipe ve en un cuadro. */
data class Cuadro(
    val landmarks: List<NormalizedLandmark>?,
    /** Mínimo de los dos ojos cerrados (0 abiertos … 1 cerrados), como la web. */
    val ambosCerrados: Float,
    val ambosAbiertos: Float,
    /** Giro de la cabeza en grados (0 = de frente). */
    val yaw: Float,
)

/**
 * MediaPipe Face Landmarker: cara, 478 puntos, parpadeo (blendshapes) y giro.
 *
 * Mismo criterio que la web (components/KioskMode.jsx, crearDeteccion):
 *  · GPU primero y CPU si la GPU no sirve;
 *  · el PRIMER cuadro se corre al crear (calentamiento): con GPU compila los
 *    shaders, y si revienta ahí es que ese camino no sirve y se prueba el otro;
 *  · un reloj monótono: en modo VIDEO cada marca debe ser mayor que la anterior.
 */
class Detector private constructor(private val lm: FaceLandmarker, val delegado: String) : AutoCloseable {
    companion object {
        private const val MODELO = "modelos/face_landmarker.task"

        fun crear(context: Context): Detector {
            fun intentar(delegado: Delegate): Detector {
                val opciones = FaceLandmarker.FaceLandmarkerOptions.builder()
                    .setBaseOptions(BaseOptions.builder().setModelAssetPath(MODELO).setDelegate(delegado).build())
                    .setRunningMode(RunningMode.VIDEO)
                    .setNumFaces(1)
                    .setOutputFaceBlendshapes(true)
                    .setOutputFacialTransformationMatrixes(true)
                    .build()
                val lm = FaceLandmarker.createFromOptions(context, opciones)
                val d = Detector(lm, delegado.name)
                try {
                    val gris = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GRAY) }
                    val t = System.nanoTime()
                    d.analizar(gris)
                    Log.i("Kiosco", "MediaPipe ${delegado.name} calentado: primer cuadro ${(System.nanoTime() - t) / 1_000_000} ms")
                } catch (e: Throwable) {
                    lm.close()
                    throw e
                }
                return d
            }
            return try {
                intentar(Delegate.GPU)
            } catch (e: Throwable) {
                Log.w("Kiosco", "MediaPipe con GPU no sirvió; probando CPU", e)
                intentar(Delegate.CPU)
            }
        }
    }

    private var ultimaMarca = 0L

    /** Reloj único y creciente (ms), como mpTs() de la web. */
    private fun marca(): Long {
        ultimaMarca = max(System.currentTimeMillis(), ultimaMarca + 1)
        return ultimaMarca
    }

    /** `imagen` DERECHA y sin espejo. */
    @Synchronized
    fun analizar(imagen: Bitmap): Cuadro {
        val r = lm.detectForVideo(BitmapImageBuilder(imagen).build(), marca())
        val puntos = r.faceLandmarks().firstOrNull()
        var cerrados = 0f
        var abiertos = 0f
        r.faceBlendshapes().orElse(null)?.firstOrNull()?.let { cats ->
            fun por(n: String) = cats.firstOrNull { it.categoryName() == n }?.score() ?: 0f
            cerrados = min(por("eyeBlinkLeft"), por("eyeBlinkRight"))
            abiertos = max(por("eyeBlinkLeft"), por("eyeBlinkRight"))
        }
        var yaw = 0f
        r.facialTransformationMatrixes().orElse(null)?.firstOrNull()?.let { m ->
            // Misma fórmula que la web: atan2(−m[8], m[0]).
            yaw = Math.toDegrees(atan2(-m[8].toDouble(), m[0].toDouble())).toFloat()
        }
        return Cuadro(puntos, cerrados, abiertos, yaw)
    }

    override fun close() = lm.close()
}
