package co.asistencia.kiosco

import android.content.Context
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/** Fechas ISO-8601 en UTC, como toISOString() de la web. */
object Iso {
    private val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    fun ahora(): String = synchronized(fmt) { fmt.format(Date()) }
    private val sinMs = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    /** El servidor responde como toISOString() («…T16:51:02.123Z»); se acepta también sin milisegundos. */
    fun leer(iso: String): Date? = synchronized(fmt) {
        runCatching { fmt.parse(iso) }.getOrNull() ?: runCatching { sinMs.parse(iso) }.getOrNull()
    }
}

/**
 * Marcaciones hechas SIN red: quedan aquí (con la hora del aparato) y se
 * reenvían solas. Son horas trabajadas: nunca se pierden.
 *
 * A diferencia de la versión web, un envío en curso NO pisa lo que llegue
 * mientras tanto: cada item lleva su id y solo se quitan los que se enviaron.
 * Y un solo envío a la vez (mutex).
 */
class Cola(context: Context) {
    private val archivo = File(context.filesDir, "cola-marcaciones.json")
    private val candado = Any()
    private val enviando = Mutex()

    private fun leer(): JSONArray = synchronized(candado) {
        runCatching { JSONArray(archivo.readText()) }.getOrElse { JSONArray() }
    }

    private fun escribir(a: JSONArray) = synchronized(candado) {
        val tmp = File(archivo.path + ".tmp")
        tmp.writeText(a.toString())
        tmp.renameTo(archivo)
    }

    fun pendientes(): Int = leer().length()

    /** Agrega y devuelve cuántas quedan en cola. */
    fun agregar(item: JSONObject): Int = synchronized(candado) {
        val a = leer()
        a.put(item.put("_id", UUID.randomUUID().toString()))
        escribir(a)
        a.length()
    }

    /** Envía cada item con [enviar]; los que devuelvan true salen de la cola. */
    suspend fun procesar(enviar: suspend (JSONObject) -> Boolean) = enviando.withLock {
        val lote = leer()
        val listos = mutableSetOf<String>()
        for (i in 0 until lote.length()) {
            val item = lote.getJSONObject(i)
            val id = item.optString("_id")
            val cuerpo = JSONObject(item.toString()).apply { remove("_id") }
            if (enviar(cuerpo)) listos += id else break // sin red: el resto espera al próximo intento
        }
        if (listos.isNotEmpty()) synchronized(candado) {
            val actual = leer()
            val queda = JSONArray()
            for (i in 0 until actual.length()) actual.getJSONObject(i).let { if (it.optString("_id") !in listos) queda.put(it) }
            escribir(queda)
        }
    }
}
