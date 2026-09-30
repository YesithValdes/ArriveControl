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
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import kotlin.math.abs

// Mismas reglas de decisión que la web (utils/faceMath.js).
private const val UMBRAL = 0.45f
private const val MARGEN = 0.08f

/**
 * Kiosco AsistencIA, con el mismo diseño del kiosco web:
 *   Activación (código) → Reposo («Iniciar kiosco») → Cámara.
 *
 * Etapa actual: reconoce pero NO marca todavía (como el «modo prueba» de la
 * web). El botón ⓘ muestra los números para la prueba de compatibilidad.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // La app ocupa toda la pantalla; cada vista reserva el espacio de las
        // barras del sistema con safeDrawingPadding().
        enableEdgeToEdge()
        val almacen = Almacen(this)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Colores.Marino), typography = Tipografia) {
                var clave by remember { mutableStateOf(almacen.clave) }
                Surface(Modifier.fillMaxSize(), color = Colores.Fondo) {
                    if (clave == null) {
                        Activacion(onListo = { a ->
                            almacen.clave = a.clave
                            almacen.sedeId = a.sedeId
                            clave = a.clave
                        })
                    } else {
                        Kiosco(almacen, onRevocado = { almacen.olvidar(); clave = null })
                    }
                }
            }
        }
    }
}

// ── Activación ──────────────────────────────────────────────────────────
@Composable
private fun Activacion(onListo: (Activacion) -> Unit) {
    val alcance = rememberCoroutineScope()
    var codigo by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var ocupado by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().safeDrawingPadding().padding(22.dp), contentAlignment = Alignment.Center) {
        Column(
            Modifier.fillMaxWidth().shadow(18.dp, RoundedCornerShape(24.dp)).clip(RoundedCornerShape(24.dp))
                .background(Color.White).padding(26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            LogoApp(64.dp)
            Spacer(Modifier.height(12.dp))
            NombreApp(22.sp)
            Spacer(Modifier.height(20.dp))
            Text("Registrar este dispositivo", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Colores.Tinta)
            Spacer(Modifier.height(6.dp))
            Text(
                "Pide el código en el panel: Ajustes → Dispositivos → Vincular un aparato.",
                color = Colores.Apagado, fontSize = 13.sp, textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(18.dp))
            OutlinedTextField(
                value = if (codigo.length > 4) "${codigo.take(4)}-${codigo.drop(4)}" else codigo,
                onValueChange = { codigo = it.filter(Char::isDigit).take(8) },
                placeholder = { Text("0000-0000", Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                textStyle = LocalTextStyle.current.copy(fontSize = 26.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, letterSpacing = 3.sp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(16.dp))
            BotonPrincipal(
                texto = if (ocupado) "Registrando…" else "Registrar dispositivo",
                habilitado = codigo.length == 8 && !ocupado,
            ) {
                ocupado = true; error = null
                alcance.launch {
                    runCatching { Api { null }.canjear(codigo) }
                        .onSuccess(onListo)
                        .onFailure { error = it.message }
                    ocupado = false
                }
            }
            error?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = Colores.Rojo, fontSize = 13.sp, textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun BotonPrincipal(texto: String, habilitado: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = habilitado,
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Colores.Marino, disabledContainerColor = Colores.Marino.copy(alpha = .35f)),
        contentPadding = PaddingValues(horizontal = 28.dp, vertical = 16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) { Text(texto, fontSize = 17.sp, fontWeight = FontWeight.Bold) }
}

// ── Kiosco: reposo + cámara ─────────────────────────────────────────────
private enum class Encuadre { SIN_CARA, LEJOS, CERCA, GIRADO, OK }

private data class Lectura(
    val encuadre: Encuadre = Encuadre.SIN_CARA,
    val primero: Persona? = null, val simPrimero: Float = -1f,
    val segundo: Persona? = null, val simSegundo: Float = -1f,
    val ms: Long = 0,
) {
    val margen get() = if (simSegundo >= 0) simPrimero - simSegundo else 1f
    val acepta get() = encuadre == Encuadre.OK && simPrimero >= UMBRAL && margen >= MARGEN
    val evaluada get() = encuadre == Encuadre.OK && simPrimero >= 0
}

@Composable
private fun Kiosco(almacen: Almacen, onRevocado: () -> Unit) {
    val ctx = LocalContext.current
    val dueño = LocalLifecycleOwner.current
    var permiso by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val pedirPermiso = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permiso = it }
    var corriendo by remember { mutableStateOf(false) }
    var detector by remember { mutableStateOf<Detector?>(null) }
    var rostro by remember { mutableStateOf<Rostro?>(null) }
    var gente by remember { mutableStateOf<List<Persona>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf("") }

    // Precarga: modelos y roster mientras la pantalla espera el toque (como la web).
    LaunchedEffect(Unit) {
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
            info = "Modelos en ${t1 - t0} ms · MediaPipe ${d.delegado} · compiten ${gente.size} de ${todos.size}"
            if (gente.isEmpty()) error = "Nadie con rostro registrado pertenece a la sede de este kiosco."
        }.onFailure { e -> if (e is ClaveRechazada) onRevocado() else error = e.message ?: "No se pudo preparar el kiosco." }
    }

    // Salir de la app detiene el kiosco (como la web): al volver, «Iniciar kiosco».
    DisposableEffect(dueño) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_STOP) corriendo = false }
        dueño.lifecycle.addObserver(obs)
        onDispose { dueño.lifecycle.removeObserver(obs) }
    }
    DisposableEffect(Unit) { onDispose { detector?.close(); rostro?.close() } }

    val d = detector; val r = rostro
    if (corriendo && permiso && d != null && r != null) {
        PantallaCamara(dueño, d, r, gente, info, onDetener = { corriendo = false })
    } else {
        Reposo(
            error = error,
            onIniciar = {
                if (!permiso) pedirPermiso.launch(Manifest.permission.CAMERA)
                corriendo = true
            },
        )
    }
}

@Composable
private fun Reposo(error: String?, onIniciar: () -> Unit) {
    var ahora by remember { mutableStateOf(Date()) }
    LaunchedEffect(Unit) { while (true) { ahora = Date(); delay(1000) } }
    val es = Locale.forLanguageTag("es-CO")
    val flota = rememberInfiniteTransition(label = "flota")
    val dy by flota.animateFloat(0f, -10f, infiniteRepeatable(tween(1800, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "dy")
    Column(
        Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().padding(horizontal = 28.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        MarcaFila()
        Spacer(Modifier.weight(1f))
        Text(SimpleDateFormat("HH:mm:ss", es).format(ahora), fontSize = 60.sp, fontWeight = FontWeight.ExtraBold, color = Colores.Tinta, letterSpacing = (-1).sp)
        Text(SimpleDateFormat("EEEE, d 'de' MMMM", es).format(ahora).replaceFirstChar { it.uppercase() }, fontSize = 17.sp, color = Colores.Apagado)
        Spacer(Modifier.height(34.dp))
        Box(
            Modifier.size(150.dp).clip(CircleShape).background(Colores.Fondo).border(2.dp, Colores.Borde, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Text("👋", fontSize = 58.sp, modifier = Modifier.graphicsLayer { translationY = dy }) }
        Spacer(Modifier.weight(1f))
        error?.let { Text(it, color = Colores.Rojo, fontSize = 14.sp, textAlign = TextAlign.Center); Spacer(Modifier.height(14.dp)) }
        BotonPrincipal("▶  Iniciar kiosco", onClick = onIniciar)
        Spacer(Modifier.height(16.dp))
        Text("🔐 No se guardan fotos", fontSize = 12.sp, color = Colores.Apagado)
    }
}

@Composable
private fun PantallaCamara(
    dueño: androidx.lifecycle.LifecycleOwner, d: Detector, r: Rostro, gente: List<Persona>, info: String, onDetener: () -> Unit,
) {
    var lectura by remember { mutableStateOf(Lectura()) }
    var detalle by remember { mutableStateOf(false) }
    var ahora by remember { mutableStateOf(Date()) }
    LaunchedEffect(Unit) { while (true) { ahora = Date(); delay(1000) } }

    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().padding(horizontal = 16.dp, vertical = 12.dp)) {
        // Cabecera: marca y «Detener», como la web.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            MarcaFila(36.dp, 18.sp)
            Spacer(Modifier.weight(1f))
            OutlinedButton(onClick = onDetener, shape = RoundedCornerShape(12.dp)) {
                Box(Modifier.size(11.dp).clip(RoundedCornerShape(2.dp)).background(Colores.Tinta))
                Spacer(Modifier.width(8.dp))
                Text("Detener", color = Colores.Tinta, fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(Modifier.height(12.dp))

        // El cuadro de la cámara, con TODOS los mensajes dentro.
        val colorBorde = when {
            lectura.acepta -> Colores.Menta
            lectura.evaluada -> Colores.Rojo
            else -> Color.Transparent
        }
        Box(
            Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Color(0xFF2A3B52))
                .border(3.dp, colorBorde, RoundedCornerShape(24.dp)),
        ) {
            Camara(dueño) { bmp -> lectura = analizar(d, r, gente, bmp, lectura) }
            GuiaYEsquinas(ok = lectura.encuadre == Encuadre.OK)

            // Velo del veredicto + icono.
            val veloAlfa by animateFloatAsState(if (lectura.evaluada) 1f else 0f, tween(250), label = "velo")
            if (veloAlfa > 0f) {
                Box(Modifier.matchParentSize().graphicsLayer { alpha = veloAlfa }.background((if (lectura.acepta) Colores.Menta else Colores.Rojo).copy(alpha = .38f)), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(86.dp).clip(CircleShape).background(if (lectura.acepta) Colores.Menta else Colores.Rojo), contentAlignment = Alignment.Center) {
                        Text(if (lectura.acepta) "✓" else "✕", color = Color.White, fontSize = 42.sp, fontWeight = FontWeight.Bold, fontFamily = Sora)
                    }
                }
            }

            // Arriba: instrucción y reloj.
            Box(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent))).padding(12.dp)) {
                Pildora(
                    when (lectura.encuadre) {
                        Encuadre.SIN_CARA -> "AsistencIA"
                        Encuadre.LEJOS -> "Acércate un poco"
                        Encuadre.CERCA -> "Aléjate un poco"
                        Encuadre.GIRADO -> "Mira de frente"
                        Encuadre.OK -> "Mira de frente"
                    },
                    Modifier.align(Alignment.CenterStart),
                )
                Pildora(SimpleDateFormat("HH:mm", Locale.getDefault()).format(ahora), Modifier.align(Alignment.CenterEnd))
            }

            // Centro: invitación cuando no hay nadie.
            if (lectura.encuadre == Encuadre.SIN_CARA) {
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Acércate para marcar", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, fontFamily = Sora)
                    Text("tu asistencia", color = Color.White.copy(alpha = .85f), fontSize = 17.sp, fontFamily = Sora)
                }
            }

            // Abajo: el veredicto (etiqueta de color, nombre, detalle).
            if (lectura.evaluada) {
                Column(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000)))).padding(18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Etiqueta(if (lectura.acepta) "Reconocido" else "✕ No reconocido", if (lectura.acepta) Colores.Azul else Colores.Rojo)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        if (lectura.acepta) "Sí, es ${lectura.primero?.nombre}" else "Intenta de nuevo",
                        color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center, fontFamily = Sora,
                    )
                    Text(
                        if (lectura.acepta) "Modo prueba: no se registró ninguna marcación" else "Mírate de frente, con buena luz",
                        color = Color.White.copy(alpha = .85f), fontSize = 13.sp, fontFamily = Sora,
                    )
                }
            }
        }

        // Pie: privacidad y el botón de detalles para la prueba de compatibilidad.
        Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("🔐 No se guardan fotos", fontSize = 12.sp, color = Colores.Apagado, modifier = Modifier.weight(1f))
            TextButton(onClick = { detalle = !detalle }) { Text(if (detalle) "Ocultar ⓘ" else "ⓘ", color = Colores.Apagado) }
        }
        if (detalle) {
            val l = lectura
            Text(
                "1º ${l.primero?.nombre ?: "—"} ${"%.3f".format(l.simPrimero)} · 2º ${l.segundo?.nombre ?: "—"} ${"%.3f".format(l.simSegundo)}\n" +
                    "margen ${"%.3f".format(l.margen)} (mín. $MARGEN) · umbral $UMBRAL · descriptor ${l.ms} ms\n$info",
                fontSize = 11.sp, color = Colores.Apagado,
            )
        }
    }
}

/** Una lectura: MediaPipe → encuadre → (si está bien) ArcFace y ranking. */
private fun analizar(d: Detector, r: Rostro, gente: List<Persona>, bmp: Bitmap, antes: Lectura): Lectura {
    val cuadro = d.analizar(bmp)
    val lm = cuadro.landmarks ?: return Lectura()
    // Ancho de la cara (mejilla a mejilla, 234 ↔ 454) respecto al cuadro.
    val ancho = abs(lm[454].x() - lm[234].x())
    val encuadre = when {
        ancho < 0.22f -> Encuadre.LEJOS
        ancho > 0.80f -> Encuadre.CERCA
        abs(cuadro.yaw) >= 12f -> Encuadre.GIRADO // solo de frente, como la web
        else -> Encuadre.OK
    }
    if (encuadre != Encuadre.OK) return Lectura(encuadre)
    val t = System.currentTimeMillis()
    val vivo = r.descriptor(bmp, Rostro.puntos5(lm, bmp.width, bmp.height))
    // Por persona gana su rostro MÁS parecido (nunca el promedio).
    val ranking = gente.map { p -> p to p.rostrosV2.maxOf { Rostro.similitud(it, vivo) } }.sortedByDescending { it.second }
    return Lectura(
        encuadre = Encuadre.OK,
        primero = ranking.getOrNull(0)?.first, simPrimero = ranking.getOrNull(0)?.second ?: -1f,
        segundo = ranking.getOrNull(1)?.first, simSegundo = ranking.getOrNull(1)?.second ?: -1f,
        ms = System.currentTimeMillis() - t,
    )
}

@Composable
private fun Pildora(texto: String, modifier: Modifier = Modifier) {
    Text(
        texto, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold, fontFamily = Sora,
        modifier = modifier.clip(RoundedCornerShape(50)).background(Color(0x9E0A1424)).padding(horizontal = 14.dp, vertical = 7.dp),
    )
}

@Composable
private fun Etiqueta(texto: String, color: Color) {
    Text(
        texto, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp, fontFamily = Sora,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(color).padding(horizontal = 14.dp, vertical = 5.dp),
    )
}

/** Óvalo guía (verde y sólido cuando el encuadre es bueno) y esquinas del visor. */
@Composable
private fun GuiaYEsquinas(ok: Boolean) {
    val pulso = rememberInfiniteTransition(label = "guia")
    val alfa by pulso.animateFloat(.55f, 1f, infiniteRepeatable(tween(1100), RepeatMode.Reverse), label = "alfa")
    Canvas(Modifier.fillMaxSize()) {
        val w = size.width; val h = size.height
        val ow = w * 0.62f; val oh = ow * 1.25f
        val tl = Offset((w - ow) / 2, h * 0.16f)
        if (ok) {
            drawOval(Color(0xFF5CE09A), tl, Size(ow, oh), style = Stroke(width = 3.dp.toPx()))
        } else {
            drawOval(Color.White.copy(alpha = alfa * .8f), tl, Size(ow, oh),
                style = Stroke(width = 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(14f, 12f))))
        }
        val l = 26.dp.toPx(); val m = 12.dp.toPx(); val sw = 3.5.dp.toPx(); val c = Color.White.copy(alpha = .9f)
        fun esquina(x: Float, y: Float, dx: Float, dy: Float) {
            drawLine(c, Offset(x, y), Offset(x + dx * l, y), sw, StrokeCap.Round)
            drawLine(c, Offset(x, y), Offset(x, y + dy * l), sw, StrokeCap.Round)
        }
        esquina(m, m, 1f, 1f); esquina(w - m, m, -1f, 1f); esquina(m, h - m, 1f, -1f); esquina(w - m, h - m, -1f, -1f)
    }
}

/** Cámara frontal: vista previa + análisis de cuadros (imagen derecha, sin espejo). */
@Composable
private fun Camara(dueño: androidx.lifecycle.LifecycleOwner, alAnalizar: (Bitmap) -> Unit) {
    val ctx = LocalContext.current
    val hilo = remember { Executors.newSingleThreadExecutor() }
    val ultimo = remember { longArrayOf(0L) } // último cuadro analizado (ms)
    DisposableEffect(Unit) {
        onDispose {
            runCatching { ProcessCameraProvider.getInstance(ctx).get().unbindAll() }
            hilo.shutdown()
        }
    }
    AndroidView(modifier = Modifier.fillMaxSize(), factory = { c ->
        val vista = PreviewView(c).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
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
                    if (ahora - ultimo[0] >= 150) {
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
