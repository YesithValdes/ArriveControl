package co.asistencia.kiosco

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.concurrent.thread
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sin

/**
 * Los mismos timbres del kiosco web (KioskMode.jsx: sonar), sintetizados: la
 * persona sabe qué pasó sin mirar la pantalla. Entrada sube, salida baja,
 * aviso es un toque neutro y el error es grave.
 */
object Sonidos {
    private const val TASA = 22050

    // [frecuencia Hz, arranque s, duración s]
    private val NOTAS = mapOf(
        "entrada" to listOf(Triple(784.0, 0.0, 0.13), Triple(1046.5, 0.11, 0.20)),
        "salida" to listOf(Triple(1046.5, 0.0, 0.13), Triple(784.0, 0.11, 0.20)),
        "aviso" to listOf(Triple(659.3, 0.0, 0.20)),
        "error" to listOf(Triple(311.1, 0.0, 0.20), Triple(233.1, 0.16, 0.30)),
    )

    fun sonar(tipo: String) {
        val notas = NOTAS[tipo] ?: return
        thread(name = "sonido") {
            runCatching {
                val total = notas.maxOf { it.second + it.third } + 0.05
                val muestras = FloatArray((total * TASA).toInt())
                for ((hz, desde, dur) in notas) {
                    val i0 = (desde * TASA).toInt()
                    val n = (dur * TASA).toInt()
                    for (k in 0 until n) {
                        if (i0 + k >= muestras.size) break
                        val t = k.toDouble() / TASA
                        // Envolvente suave: sin «clic» al arrancar ni al cortar.
                        val env = min(1.0, t / 0.015) * exp(-4.0 * t / dur)
                        muestras[i0 + k] += (0.22 * env * sin(2 * PI * hz * t)).toFloat()
                    }
                }
                val pcm = ShortArray(muestras.size) { (muestras[it].coerceIn(-1f, 1f) * Short.MAX_VALUE).toInt().toShort() }
                val pista = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(TASA).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setBufferSizeInBytes(pcm.size * 2)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build()
                pista.write(pcm, 0, pcm.size)
                pista.play()
                Thread.sleep((total * 1000).toLong() + 100)
                pista.release()
            }
        }
    }
}
