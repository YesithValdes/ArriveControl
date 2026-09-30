package co.asistencia.kiosco

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import kotlin.math.abs

private val Marino = Color(0xFF13294B)
private val Menta = Color(0xFF2FBF8F)

// Mismas reglas de decisión que la web (utils/faceMath.js).
private const val UMBRAL = 0.45f
private const val MARGEN = 0.08f

/**
 * PROTOTIPO (etapa 1): activación + prueba de compatibilidad de rostros.
 *
 * No marca asistencia. Muestra, en vivo, con quién del roster se parece la
 * cara y cuánto, para comprobar que los descriptores nativos coinciden con
 * los que la web ya guardó. Si coinciden, los rostros registrados sirven y
 * nadie tiene que volver a registrarse.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val almacen = Almacen(this)
        setContent {
            MaterialTheme {
                var clave by remember { mutableStateOf(almacen.clave) }
                Surface(Modifier.fillMaxSize()) {
                    if (clave == null) {
                        Activacion(onListo = { a ->
                            almacen.clave = a.clave
                            almacen.sedeId = a.sedeId
                            clave = a.clave
                        })
                    } else {
                        PruebaCompatibilidad(almacen, onOlvidar = { almacen.olvidar(); clave = null })
                    }
                }
            }
        }
    }
}

@Composable
private fun Activacion(onListo: (Activacion) -> Unit) {
    val alcance = rememberCoroutineScope()
    var codigo by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var ocupado by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("ASISTENCIA", fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, color = Marino)
        Spacer(Modifier.height(18.dp))
        Text("Registrar este dispositivo", fontWeight = FontWeight.Bold)
        Text("Pide el código en el panel: Ajustes → Dispositivos → Vincular un aparato.", color = Color.Gray, fontSize = 13.sp)
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = codigo,
            onValueChange = { codigo = it.filter(Char::isDigit).take(8) },
            label = { Text("Código de 8 dígitos") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
        )
        Spacer(Modifier.height(12.dp))
        Button(
            enabled = codigo.length == 8 && !ocupado,
            colors = ButtonDefaults.buttonColors(containerColor = Marino),
            onClick = {
                ocupado = true; error = null
                alcance.launch {
                    runCatching { Api { null }.canjear(codigo) }
                        .onSuccess(onListo)
                        .onFailure { error = it.message }
                    ocupado = false
                }
            },
        ) { Text(if (ocupado) "Registrando…" else "Registrar dispositivo") }
        error?.let { Spacer(Modifier.height(10.dp)); Text(it, color = Color(0xFFB3403A)) }
    }
}

private data class Lectura(
    val primero: String = "—", val simPrimero: Float = -1f,
    val segundo: String = "—", val simSegundo: Float = -1f,
    val yaw: Float = 0f, val cara: Boolean = false, val msDescriptor: Long = 0,
)

@Composable
private fun PruebaCompatibilidad(almacen: Almacen, onOlvidar: () -> Unit) {
    val ctx = LocalContext.current
    val dueño = LocalLifecycleOwner.current
    val alcance = rememberCoroutineScope()
    var permiso by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val pedirPermiso = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permiso = it }
    var estado by remember { mutableStateOf("Cargando modelos y roster…") }
    var lectura by remember { mutableStateOf(Lectura()) }
    var detector by remember { mutableStateOf<Detector?>(null) }
    var rostro by remember { mutableStateOf<Rostro?>(null) }
    var gente by remember { mutableStateOf<List<Persona>>(emptyList()) }

    LaunchedEffect(Unit) {
        if (!permiso) pedirPermiso.launch(Manifest.permission.CAMERA)
        val api = Api { almacen.clave }
        runCatching {
            // La sede se relee: se puede cambiar desde el panel.
            api.yo()?.let { d -> almacen.sedeId = d.optString("sede_id").ifBlank { null }?.takeIf { it != "null" } }
            val t0 = System.currentTimeMillis()
            val (d, r) = withContext(Dispatchers.Default) { Detector.crear(ctx) to Rostro(ctx) }
            val t1 = System.currentTimeMillis()
            val todos = api.roster()
            val sede = almacen.sedeId
            // Mismo filtro que la web: su sede + quienes no tienen sede.
            gente = todos.filter { it.rostrosV2.isNotEmpty() && (sede == null || it.sedeId == null || it.sedeId == sede) }
            detector = d; rostro = r
            estado = "Modelos listos en ${t1 - t0} ms (MediaPipe ${d.delegado}) · compiten ${gente.size} de ${todos.size} personas"
        }.onFailure { e ->
            if (e is ClaveRechazada) onOlvidar() else estado = "Error: ${e.message}"
        }
    }

    Column(Modifier.fillMaxSize().background(Color(0xFFF2F6FC))) {
        Row(Modifier.fillMaxWidth().background(Marino).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("ASISTENCIA · prueba de compatibilidad", color = Color.White, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = onOlvidar) { Text("Olvidar", color = Color.White) }
        }
        Text(estado, fontSize = 12.sp, color = Color.DarkGray, modifier = Modifier.padding(10.dp))

        Box(Modifier.weight(1f).fillMaxWidth()) {
            val d = detector; val r = rostro
            if (permiso && d != null && r != null) {
                Camara(dueño = dueño, alAnalizar = { bmp ->
                    val cuadro = d.analizar(bmp)
                    val lm = cuadro.landmarks
                    if (lm == null) { lectura = Lectura(); return@Camara }
                    if (abs(cuadro.yaw) >= 12f) { lectura = lectura.copy(cara = true, yaw = cuadro.yaw); return@Camara }
                    val t = System.currentTimeMillis()
                    val vivo = r.descriptor(bmp, Rostro.puntos5(lm, bmp.width, bmp.height))
                    val ms = System.currentTimeMillis() - t
                    // Por persona gana su rostro MÁS parecido (nunca el promedio).
                    val ranking = gente.map { p -> p to p.rostrosV2.maxOf { Rostro.similitud(it, vivo) } }.sortedByDescending { it.second }
                    lectura = Lectura(
                        primero = ranking.getOrNull(0)?.first?.nombre ?: "—", simPrimero = ranking.getOrNull(0)?.second ?: -1f,
                        segundo = ranking.getOrNull(1)?.first?.nombre ?: "—", simSegundo = ranking.getOrNull(1)?.second ?: -1f,
                        yaw = cuadro.yaw, cara = true, msDescriptor = ms,
                    )
                })
            } else if (!permiso) {
                Text("Se necesita la cámara.", Modifier.align(Alignment.Center))
            }
        }

        val l = lectura
        val margen = if (l.simSegundo >= 0) l.simPrimero - l.simSegundo else 1f
        val acepta = l.simPrimero >= UMBRAL && margen >= MARGEN
        Column(Modifier.fillMaxWidth().background(Color.White).padding(16.dp)) {
            when {
                !l.cara -> Text("Sin cara: acércate a la cámara", color = Color.Gray)
                abs(l.yaw) >= 12f -> Text("Mira de frente (giro ${l.yaw.toInt()}°)", color = Color.Gray)
                else -> {
                    Text(if (acepta) "✓ ${l.primero}" else "✕ no aceptaría", fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, color = if (acepta) Menta else Color(0xFFB3403A))
                    Text("1º ${l.primero}: ${"%.3f".format(l.simPrimero)}   ·   2º ${l.segundo}: ${"%.3f".format(l.simSegundo)}", fontSize = 13.sp)
                    Text("margen ${"%.3f".format(margen)} (mín. $MARGEN) · umbral $UMBRAL · descriptor ${l.msDescriptor} ms", fontSize = 12.sp, color = Color.Gray)
                }
            }
        }
    }

    DisposableEffect(Unit) { onDispose { detector?.close(); rostro?.close() } }
}

/** Cámara frontal: vista previa + análisis de cuadros (imagen derecha, sin espejo). */
@Composable
private fun Camara(dueño: androidx.lifecycle.LifecycleOwner, alAnalizar: (Bitmap) -> Unit) {
    val ctx = LocalContext.current
    val hilo = remember { Executors.newSingleThreadExecutor() }
    val ultimo = remember { longArrayOf(0L) } // último cuadro analizado (ms)
    AndroidView(modifier = Modifier.fillMaxSize(), factory = { c ->
        val vista = PreviewView(c)
        val futuro = ProcessCameraProvider.getInstance(c)
        futuro.addListener({
            val proveedor = futuro.get()
            val vistaPrevia = Preview.Builder().build().also { it.setSurfaceProvider(vista.surfaceProvider) }
            val analisis = ImageAnalysis.Builder()
                // ~720p, como el video que usa la web (1280×720 ideal).
                .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(
                    ResolutionStrategy(android.util.Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analisis.setAnalyzer(hilo) { img ->
                try {
                    val ahora = System.currentTimeMillis()
                    if (ahora - ultimo[0] >= 250) { // ~4 lecturas por segundo bastan para la prueba
                        ultimo[0] = ahora
                        val crudo = img.toBitmap()
                        // Derecha y SIN espejo: igual que el video crudo del navegador.
                        val derecho = if (img.imageInfo.rotationDegrees == 0) crudo else
                            Bitmap.createBitmap(crudo, 0, 0, crudo.width, crudo.height,
                                Matrix().apply { postRotate(img.imageInfo.rotationDegrees.toFloat()) }, true)
                        alAnalizar(derecho)
                    }
                } catch (e: Throwable) {
                    Log.e("Kiosco", "Error en un cuadro", e)
                } finally {
                    img.close()
                }
            }
            proveedor.unbindAll()
            proveedor.bindToLifecycle(dueño, CameraSelector.DEFAULT_FRONT_CAMERA, vistaPrevia, analisis)
        }, ContextCompat.getMainExecutor(ctx))
        vista
    })
}
