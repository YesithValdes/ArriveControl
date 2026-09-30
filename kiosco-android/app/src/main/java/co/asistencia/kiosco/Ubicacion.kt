package co.asistencia.kiosco

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.Executors
import kotlin.coroutines.resume

/**
 * Ubicación para las marcaciones (KioskMode.jsx: pedirGpsAhora / gpsParaMarcar).
 *
 * Se pide al EMPEZAR cada reconocimiento, sin alta precisión (la de red llega
 * en 1–2 s y alcanza: ±20–30 m), para que al marcar ya esté. Solo vale una de
 * menos de 2 minutos: una vieja diría dónde ESTUVO el aparato. Sin permiso no
 * viaja nada; el servidor decide si la exige (validar_ubicacion / validar_sede).
 */
class Ubicacion(private val context: Context) {
    private val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val hilo = Executors.newSingleThreadExecutor()
    @Volatile private var ultima: Gps? = null

    fun hayPermiso() = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun fresca(): Gps? = ultima?.takeIf { System.currentTimeMillis() - it.ts < 120_000 }

    private fun guardar(l: Location?) = l?.let {
        Gps(it.latitude, it.longitude, if (it.hasAccuracy()) it.accuracy else null, System.currentTimeMillis()).also { g -> ultima = g }
    }

    /** Una posición ya (o la que llegue antes de [msMax]); null sin permiso o sin señal. */
    @SuppressLint("MissingPermission")
    suspend fun pedir(msMax: Long = 12_000): Gps? {
        if (!hayPermiso()) return null
        fresca()?.let { return it }
        val proveedor = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.FUSED_PROVIDER)
            .firstOrNull { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) } ?: return null
        return withTimeoutOrNull(msMax) {
            suspendCancellableCoroutine { cont ->
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        lm.getCurrentLocation(proveedor, null, hilo) { l -> if (cont.isActive) cont.resume(guardar(l)) }
                    } else {
                        @Suppress("DEPRECATION")
                        lm.requestSingleUpdate(proveedor, { l -> if (cont.isActive) cont.resume(guardar(l)) }, Looper.getMainLooper())
                    }
                } catch (e: Exception) {
                    if (cont.isActive) cont.resume(null)
                }
            }
        }
    }
}
