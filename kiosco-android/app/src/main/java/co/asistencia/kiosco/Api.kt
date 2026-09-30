package co.asistencia.kiosco

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** El servidor dijo que esta clave ya no vale (401): hay que reactivar el aparato. */
class ClaveRechazada(msg: String?) : Exception(msg ?: "Clave de dispositivo rechazada")

/** Una persona del roster, con sus rostros ArcFace (512 floats, normalizados). */
data class Persona(
    val id: String,
    val nombre: String,
    val sedeId: String?,
    val validarSede: Boolean,
    val rostrosV2: List<FloatArray>,
)

data class Activacion(val clave: String, val nombre: String, val sedeId: String?, val empresa: String)

/**
 * Las MISMAS rutas del kiosco web (services/kioskoApi.js): el servidor no
 * cambia nada. El aparato se identifica con el encabezado X-Device-Key.
 */
class Api(private val clave: () -> String?) {
    private val base = BuildConfig.SERVIDOR

    private fun pedir(metodo: String, ruta: String, cuerpo: JSONObject? = null): Pair<Int, JSONObject?> {
        val con = (URL(base + ruta).openConnection() as HttpURLConnection).apply {
            requestMethod = metodo
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
            clave()?.let { setRequestProperty("X-Device-Key", it) }
            if (cuerpo != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                outputStream.use { it.write(cuerpo.toString().toByteArray()) }
            }
        }
        return try {
            val codigo = con.responseCode
            val flujo = if (codigo in 200..299) con.inputStream else con.errorStream
            val texto = flujo?.bufferedReader()?.use { it.readText() }.orEmpty()
            codigo to runCatching { JSONObject(texto) }.getOrNull()
        } finally {
            con.disconnect()
        }
    }

    /** Canjea el código de 8 dígitos que genera el panel (Ajustes → Dispositivos). */
    suspend fun canjear(codigo: String): Activacion = withContext(Dispatchers.IO) {
        val (st, j) = pedir("POST", "/api/dispositivos/canjear", JSONObject().put("codigo", codigo.filter(Char::isDigit)))
        if (st !in 200..299 || j?.optBoolean("ok") != true) error(j?.optString("error")?.ifBlank { null } ?: "El servidor respondió $st.")
        val d = j.getJSONObject("dispositivo")
        Activacion(d.getString("clave"), d.optString("nombre"), d.optString("sede_id").ifBlank { null }?.takeIf { it != "null" }, j.optString("empresa"))
    }

    /** El aparato según el servidor (sede actual: se puede cambiar desde el panel). */
    suspend fun yo(): JSONObject? = withContext(Dispatchers.IO) {
        val (st, j) = pedir("GET", "/api/dispositivos/yo")
        if (st == 401) throw ClaveRechazada(j?.optString("error"))
        j?.optJSONObject("dispositivo")
    }

    /** Roster facial de la empresa del aparato. */
    suspend fun roster(): List<Persona> = withContext(Dispatchers.IO) {
        val (st, j) = pedir("GET", "/api/empleados?rostros=1")
        if (st == 401) throw ClaveRechazada(j?.optString("detalle") ?: j?.optString("error"))
        if (st !in 200..299 || j == null) error("No se pudo cargar el roster (HTTP $st).")
        val lista = j.getJSONArray("empleados")
        (0 until lista.length()).map { i ->
            val e = lista.getJSONObject(i)
            val pares = e.optJSONArray("rostros_pares") ?: JSONArray()
            val v2 = (0 until pares.length()).mapNotNull { k ->
                pares.optJSONObject(k)?.optJSONArray("v2")?.takeIf { it.length() == Rostro.LARGO }?.let { arr ->
                    FloatArray(arr.length()) { n -> arr.getDouble(n).toFloat() }
                }
            }
            Persona(
                id = e.getString("id"),
                nombre = e.optString("nombre"),
                sedeId = e.optString("sede_id").ifBlank { null }?.takeIf { it != "null" },
                validarSede = e.optBoolean("validar_sede", false),
                rostrosV2 = v2,
            )
        }
    }
}
