package co.asistencia.kiosco

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
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

/** Ubicación del aparato para una marcación. */
data class Gps(val lat: Double, val lon: Double, val precisionM: Float?, val ts: Long)

/** Lo que respondió el servidor al registrar (services/kioskoApi.js: registrarPaso). */
sealed class Paso {
    data class Registrado(val tipo: String, val tsIso: String, val id: String?, val trabajadoHoySeg: Long?) : Paso()
    data class Duplicado(val tipoUltima: String, val tsUltimaIso: String) : Paso()
    /** Sin red: quedó en la cola del aparato; se envía sola. */
    data class EnCola(val enCola: Int) : Paso()
    data class Error(val mensaje: String) : Paso()
}

/**
 * Las MISMAS rutas del kiosco web (services/kioskoApi.js): el servidor no
 * cambia nada. El aparato se identifica con el encabezado X-Device-Key.
 */
class Api(private val clave: () -> String?) {
    private val base = BuildConfig.SERVIDOR

    /** @throws IOException si no hay red (el servidor ni contestó). */
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

    private fun JSONObject?.mensaje(st: Int) =
        this?.optString("detalle")?.ifBlank { null } ?: this?.optString("error")?.ifBlank { null } ?: "El servidor respondió $st."

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

    /** Roster facial CRUDO (JSON) de la empresa del aparato: se guarda tal cual para usarlo sin red. */
    suspend fun rosterCrudo(): String = withContext(Dispatchers.IO) {
        val (st, j) = pedir("GET", "/api/empleados?rostros=1")
        if (st == 401) throw ClaveRechazada(j.mensaje(st))
        if (st !in 200..299 || j == null) error("No se pudo cargar el roster (HTTP $st).")
        j.toString()
    }

    /**
     * Registra un paso. El SERVIDOR decide entrada/salida y pone la hora.
     * Sin red (el servidor ni contestó): a la cola, con la hora del aparato.
     * Un error del servidor NO se encola: reintentarlo no lo arreglaría.
     */
    suspend fun marcar(empleadoId: String, sedeId: String?, gps: Gps?, cola: Cola): Paso = withContext(Dispatchers.IO) {
        val cuerpo = JSONObject().put("empleado_id", empleadoId).put("sede_id", sedeId ?: JSONObject.NULL)
        gps?.let {
            cuerpo.put("lat", it.lat).put("lon", it.lon)
            it.precisionM?.let { p -> cuerpo.put("precision_m", Math.round(p)) }
        }
        val (st, j) = try {
            pedir("POST", "/api/marcaciones", cuerpo)
        } catch (e: IOException) {
            val n = cola.agregar(JSONObject(cuerpo.toString()).put("ts_dispositivo", Iso.ahora()).put("diferido", true))
            return@withContext Paso.EnCola(n)
        }
        when {
            st == 401 -> throw ClaveRechazada(j.mensaje(st))
            st == 404 -> Paso.Error("Empleado no encontrado en la base de datos.")
            st !in 200..299 -> Paso.Error(j.mensaje(st))
            j?.optBoolean("duplicado") == true -> j.optJSONObject("ultima").let { u ->
                Paso.Duplicado(u?.optString("tipo") ?: "", u?.optString("ts") ?: "")
            }
            else -> Paso.Registrado(
                tipo = j?.optString("tipo") ?: "entrada",
                tsIso = j?.optJSONObject("marcacion")?.optString("ts") ?: Iso.ahora(),
                id = j?.optJSONObject("marcacion")?.optString("id")?.ifBlank { null },
                trabajadoHoySeg = j?.takeIf { it.has("trabajado_hoy_seg") && !it.isNull("trabajado_hoy_seg") }?.optLong("trabajado_hoy_seg"),
            )
        }
    }

    /** La ubicación llegó DESPUÉS de marcar: se adjunta (mejor esfuerzo). */
    suspend fun adjuntarUbicacion(marcacionId: String, gps: Gps) = withContext(Dispatchers.IO) {
        runCatching {
            val c = JSONObject().put("lat", gps.lat).put("lon", gps.lon)
            gps.precisionM?.let { c.put("precision_m", Math.round(it)) }
            pedir("POST", "/api/marcaciones/$marcacionId/ubicacion", c)
        }
    }

    /** Telemetría del intento (sin biometría; solo escalares). Nunca bloquea. */
    suspend fun intento(empleadoId: String?, aceptado: Boolean, livenessOk: Boolean, sedeId: String?, v2Mejor: Float?, v2Segundo: Float?) =
        withContext(Dispatchers.IO) {
            runCatching {
                pedir("POST", "/api/intentos", JSONObject()
                    .put("empleado_id", empleadoId ?: JSONObject.NULL).put("aceptado", aceptado)
                    .put("distancia", v2Mejor?.let { 1 - it } ?: JSONObject.NULL)
                    .put("liveness_ok", livenessOk).put("sede_id", sedeId ?: JSONObject.NULL)
                    .put("v2_mejor", v2Mejor ?: JSONObject.NULL).put("v2_segundo", v2Segundo ?: JSONObject.NULL)
                    .put("modo", "v2"))
            }
        }

    /**
     * Reenvía la cola. Una marcación rechazada DEFINITIVAMENTE (400/404) se
     * descarta; 401/402/5xx se conservan (son horas trabajadas y el rechazo
     * puede ser pasajero). Devuelve el motivo si quedó algo sin enviar.
     */
    suspend fun sincronizar(cola: Cola): String? = withContext(Dispatchers.IO) {
        var motivo: String? = null
        cola.procesar { item ->
            try {
                val (st, j) = pedir("POST", "/api/marcaciones", item)
                when {
                    st in 200..299 || st == 400 || st == 404 -> true
                    else -> { motivo = j.mensaje(st); false }
                }
            } catch (e: IOException) {
                motivo = "Sin conexión con el servidor."
                false
            }
        }
        motivo
    }

    companion object {
        /** Personas desde el JSON del roster (el mismo formato que baja la web). */
        fun personasDe(crudo: String): List<Persona> {
            val lista = JSONObject(crudo).getJSONArray("empleados")
            return (0 until lista.length()).map { i ->
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
}
