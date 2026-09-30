package co.asistencia.kiosco

import android.content.Context
import java.io.File

/**
 * Lo que el aparato recuerda entre aperturas. Equivale al localStorage del
 * kiosco web (services/kioskoApi.js).
 */
class Almacen(private val context: Context) {
    private val prefs = context.getSharedPreferences("kiosco", Context.MODE_PRIVATE)

    /** Identidad del dispositivo: se obtiene UNA vez al canjear el código. */
    var clave: String?
        get() = prefs.getString("clave", null)
        set(v) = prefs.edit().putString("clave", v).apply()

    /** Sede del aparato; null = sin sede (compara contra toda la empresa). */
    var sedeId: String?
        get() = prefs.getString("sede", null)
        set(v) = prefs.edit().apply { if (v.isNullOrBlank()) remove("sede") else putString("sede", v) }.apply()

    /** Ya se mostró y aceptó el aviso del uso del rostro (Play Store lo exige). */
    var avisoAceptado: Boolean
        get() = prefs.getBoolean("aviso_rostro", false)
        set(v) = prefs.edit().putBoolean("aviso_rostro", v).apply()

    /** Modo prueba: reconoce pero NO registra marcaciones (para ensayar). */
    var modoPrueba: Boolean
        get() = prefs.getBoolean("modo_prueba", false)
        set(v) = prefs.edit().putBoolean("modo_prueba", v).apply()

    /**
     * Última copia del roster, para seguir reconociendo sin red. Son datos
     * biométricos: viven en el almacenamiento PRIVADO de la app y se borran
     * al olvidar la activación.
     */
    private val archivoRoster get() = File(context.filesDir, "roster.json")
    var rosterCrudo: String?
        get() = runCatching { archivoRoster.readText() }.getOrNull()
        set(v) { if (v == null) archivoRoster.delete() else archivoRoster.writeText(v) }

    /** Olvida la activación. La cola de marcaciones NO se toca: son horas trabajadas. */
    fun olvidar() {
        prefs.edit().remove("clave").remove("sede").apply()
        rosterCrudo = null
    }
}
