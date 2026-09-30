package co.asistencia.kiosco

import android.content.Context

/**
 * Lo que el aparato recuerda entre aperturas: su clave (la identidad del
 * dispositivo, se obtiene UNA vez al canjear el código) y su sede.
 *
 * Equivale al localStorage del kiosco web (services/kioskoApi.js:
 * kiosco_device_key y kiosco_sede_id).
 */
class Almacen(context: Context) {
    private val prefs = context.getSharedPreferences("kiosco", Context.MODE_PRIVATE)

    var clave: String?
        get() = prefs.getString("clave", null)
        set(v) = prefs.edit().putString("clave", v).apply()

    /** Sede del aparato; null = sin sede (compara contra toda la empresa). */
    var sedeId: String?
        get() = prefs.getString("sede", null)
        set(v) = prefs.edit().apply { if (v.isNullOrBlank()) remove("sede") else putString("sede", v) }.apply()

    fun olvidar() = prefs.edit().clear().apply()
}
