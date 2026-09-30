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
import androidx.compose.ui.platform.LocalUriHandler
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
import java.io.IOException


/**
 * Kiosco AsistencIA, con el mismo diseño del kiosco web:
 *   Activación (código) → Aviso del rostro (1ª vez) → Reposo («Iniciar kiosco») → Cámara.
 *
 * El reconocimiento (parpadeo + identidad) vive en [Motor]; aquí se marca en
 * el servidor, con cola sin red, GPS y sonidos. ⓘ tiene el «modo prueba».
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
                var aviso by remember { mutableStateOf(almacen.avisoAceptado) }
                Surface(Modifier.fillMaxSize(), color = Colores.Fondo) {
                    if (clave == null) {
                        Activacion(onListo = { a ->
                            almacen.clave = a.clave
                            almacen.sedeId = a.sedeId
                            clave = a.clave
                        })
                    } else if (!aviso) {
                        AvisoRostro(onAceptar = { almacen.avisoAceptado = true; aviso = true })
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

// ── Aviso del uso del rostro (primera vez; lo exige Play Store) ─────────
/** La landing, donde viven la política de datos y los términos. */
private const val SITIO = "https://controlregistro.vercel.app"

@Composable
private fun AvisoRostro(onAceptar: () -> Unit) {
    Box(Modifier.fillMaxSize().safeDrawingPadding().padding(22.dp), contentAlignment = Alignment.Center) {
        Column(
            Modifier.fillMaxWidth().shadow(18.dp, RoundedCornerShape(24.dp)).clip(RoundedCornerShape(24.dp))
                .background(Color.White).padding(26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            LogoApp(56.dp)
            Spacer(Modifier.height(14.dp))
            Text("Uso del rostro", fontWeight = FontWeight.Bold, fontSize = 19.sp, color = Colores.Tinta)
            Spacer(Modifier.height(12.dp))
            listOf(
                "Este kiosco usa la cámara para reconocer el rostro de los colaboradores y registrar su asistencia.",
                "No se guardan fotos ni video: cada imagen se convierte en números en el aparato y se descarta.",
                "Para marcar se verifica que haya una persona real (parpadeo).",
                "Si la empresa lo exige, se registra la ubicación del aparato en cada marcación.",
            ).forEach {
                Text("•  $it", fontSize = 14.sp, color = Colores.Tinta, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
            }
            Spacer(Modifier.height(8.dp))
            val web = LocalUriHandler.current
            Row(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = { web.openUri("$SITIO/politica-datos.html") }) { Text("Tratamiento de datos", fontSize = 13.sp, color = Colores.Azul) }
                TextButton(onClick = { web.openUri("$SITIO/terminos.html") }) { Text("Términos", fontSize = 13.sp, color = Colores.Azul) }
            }
            Spacer(Modifier.height(18.dp))
            BotonPrincipal("Entendido, continuar", onClick = onAceptar)
        }
    }
}

// ── Kiosco: reposo + cámara ─────────────────────────────────────────────
private const val ROSTER_CADA_MS = 10 * 60_000L
private const val COLA_CADA_MS = 60_000L

@Composable
private fun Kiosco(almacen: Almacen, onRevocado: () -> Unit) {
    val ctx = LocalContext.current
    val dueño = LocalLifecycleOwner.current
    val api = remember { Api { almacen.clave } }
    val cola = remember { Cola(ctx) }
    val ubicacion = remember { Ubicacion(ctx) }
    var corriendo by remember { mutableStateOf(false) }
    var detector by remember { mutableStateOf<Detector?>(null) }
    var rostro by remember { mutableStateOf<Rostro?>(null) }
    var gente by remember { mutableStateOf<List<Persona>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf("") }
    var pendientes by remember { mutableIntStateOf(cola.pendientes()) }
    val revocar by rememberUpdatedState(onRevocado)

    fun hayCamara() = ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    val pedirPermisos = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        // La cámara es imprescindible; la ubicación, opcional (el servidor decide si la exige).
        if (r[Manifest.permission.CAMERA] == true || hayCamara()) corriendo = true
        else error = "Sin permiso de cámara no se puede reconocer a nadie."
    }

    /** Roster: de la red si se puede (y se guarda), si no la última copia. */
    suspend fun cargarRoster() {
        val crudo = try {
            api.rosterCrudo().also { almacen.rosterCrudo = it }
        } catch (e: ClaveRechazada) {
            throw e
        } catch (e: Exception) {
            Log.w("Kiosco", "roster sin red; se usa la copia", e)
            almacen.rosterCrudo ?: throw IllegalStateException("Sin conexión y sin copia del roster. Conéctate a internet una vez.")
        }
        val todos = withContext(Dispatchers.Default) { Api.personasDe(crudo) }
        val sede = almacen.sedeId
        // Mismo filtro que la web: su sede + quienes no tienen sede.
        gente = todos.filter { it.rostrosV2.isNotEmpty() && (sede == null || it.sedeId == null || it.sedeId == sede) }
        error = if (gente.isEmpty()) "Nadie con rostro registrado pertenece a la sede de este kiosco." else null
        info = "compiten ${gente.size} de ${todos.size}"
    }

    // Precarga: modelos y roster mientras la pantalla espera el toque (como la web).
    LaunchedEffect(Unit) {
        try {
            // La sede se relee: se puede cambiar desde el panel. Sin red, se queda la guardada.
            try {
                api.yo()?.let { d -> almacen.sedeId = d.optString("sede_id").ifBlank { null }?.takeIf { it != "null" } }
            } catch (e: IOException) { Log.w("Kiosco", "yo() sin red", e) }
            val t0 = System.currentTimeMillis()
            val (d, r) = withContext(Dispatchers.Default) { Detector.crear(ctx) to Rostro(ctx) }
            detector = d; rostro = r
            val modelos = "Modelos en ${System.currentTimeMillis() - t0} ms · MediaPipe ${d.delegado}"
            cargarRoster()
            info = "$modelos · $info"
            while (true) {
                delay(ROSTER_CADA_MS)
                runCatching { cargarRoster(); info = "$modelos · $info" }.onFailure { if (it is ClaveRechazada) throw it }
            }
        } catch (e: ClaveRechazada) {
            revocar()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: "No se pudo preparar el kiosco."
        }
    }

    // Cola sin red: se reenvía al abrir y cada minuto.
    LaunchedEffect(Unit) {
        while (true) {
            runCatching { api.sincronizar(cola) }.onSuccess { m -> m?.let { Log.i("Kiosco", "cola: $it") } }
            pendientes = cola.pendientes()
            delay(COLA_CADA_MS)
        }
    }

    // Salir de la app detiene el kiosco (como la web): al volver, «Iniciar kiosco».
    DisposableEffect(dueño) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_STOP) corriendo = false }
        dueño.lifecycle.addObserver(obs)
        onDispose { dueño.lifecycle.removeObserver(obs) }
    }
    DisposableEffect(Unit) { onDispose { detector?.close(); rostro?.close() } }

    val d = detector; val r = rostro
    if (corriendo && hayCamara() && d != null && r != null) {
        PantallaCamara(
            dueño, d, r, almacen, api, cola, ubicacion,
            gente = { gente }, info = info, pendientes = pendientes,
            alCambiarCola = { pendientes = cola.pendientes() },
            onRevocado = revocar,
            onDetener = { corriendo = false },
        )
    } else {
        Reposo(
            error = error,
            listo = d != null && r != null,
            onIniciar = {
                val faltan = listOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
                    .filter { ContextCompat.checkSelfPermission(ctx, it) != PackageManager.PERMISSION_GRANTED }
                if (faltan.isEmpty()) corriendo = true else pedirPermisos.launch(faltan.toTypedArray())
            },
        )
    }
}

@Composable
private fun Reposo(error: String?, listo: Boolean, onIniciar: () -> Unit) {
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
        // Sin «Preparando…»: el botón solo se activa cuando los modelos ya cargaron.
        BotonPrincipal("▶  Iniciar kiosco", habilitado = listo, onClick = onIniciar)
        Spacer(Modifier.height(16.dp))
        Text("🔐 No se guardan fotos", fontSize = 12.sp, color = Colores.Apagado)
    }
}

private val horaLocal get() = SimpleDateFormat("h:mm a", Locale.forLanguageTag("es-CO"))
private fun horaDe(iso: String): String = Iso.leer(iso)?.let { horaLocal.format(it) } ?: ""
private fun duracion(seg: Long): String = "${seg / 3600} h ${(seg % 3600) / 60} min"

@Composable
private fun PantallaCamara(
    dueño: androidx.lifecycle.LifecycleOwner, d: Detector, r: Rostro,
    almacen: Almacen, api: Api, cola: Cola, ubicacion: Ubicacion,
    gente: () -> List<Persona>, info: String, pendientes: Int,
    alCambiarCola: () -> Unit, onRevocado: () -> Unit, onDetener: () -> Unit,
) {
    val alcance = rememberCoroutineScope()
    var vista by remember { mutableStateOf(Vista()) }
    var detalle by remember { mutableStateOf(false) }
    var prueba by remember { mutableStateOf(almacen.modoPrueba) }
    var ultimaDecision by remember { mutableStateOf("") }
    var ahora by remember { mutableStateOf(Date()) }
    LaunchedEffect(Unit) { while (true) { ahora = Date(); delay(1000) } }
    val gente by rememberUpdatedState(gente)

    val motor = remember {
        lateinit var m: Motor
        m = Motor(
            detector = d, rostro = r,
            candidatos = { gente() },
            sedeKiosco = { almacen.sedeId },
            alIniciarReto = { alcance.launch { ubicacion.pedir() } },
            alConcluir = { ok, persona, motivo, met, sim ->
                ultimaDecision = "1º ${persona?.nombre ?: "—"} ${met.v2Mejor?.let { "%.3f".format(it) } ?: "—"} · 2º ${met.v2Segundo?.let { "%.3f".format(it) } ?: "—"}"
                alcance.launch {
                    val sede = almacen.sedeId
                    val pruebaAhora = almacen.modoPrueba
                    if (!pruebaAhora) launch { api.intento(persona?.id, ok, sim >= 0, sede, met.v2Mejor, met.v2Segundo) }
                    if (!ok) { Sonidos.sonar("error"); return@launch }
                    val p = persona!!
                    if (pruebaAhora) { m.mostrar(Resultado.Prueba(p.nombre, sim)); Sonidos.sonar("aviso"); return@launch }
                    val gps = ubicacion.fresca()
                    val res = try {
                        when (val paso = api.marcar(p.id, sede, gps, cola)) {
                            is Paso.Registrado -> {
                                // La ubicación llegó tarde: se adjunta después (mejor esfuerzo).
                                if (gps == null && paso.id != null && ubicacion.hayPermiso()) launch {
                                    ubicacion.pedir(8_000)?.let { api.adjuntarUbicacion(paso.id, it) }
                                }
                                Resultado.Marcado(p.nombre, paso.tipo != "salida", horaDe(paso.tsIso), paso.trabajadoHoySeg)
                            }
                            is Paso.Duplicado -> Resultado.YaRegistrada(p.nombre, paso.tipoUltima, horaDe(paso.tsUltimaIso))
                            is Paso.EnCola -> Resultado.Pendiente(p.nombre)
                            is Paso.Error -> Resultado.Rechazo(paso.mensaje, p.nombre)
                        }
                    } catch (e: ClaveRechazada) {
                        onRevocado(); return@launch
                    } catch (e: Exception) {
                        Resultado.Rechazo(e.message ?: "No se pudo registrar.", p.nombre)
                    }
                    alCambiarCola()
                    m.mostrar(res)
                    Sonidos.sonar(when (res) {
                        is Resultado.Marcado -> if (res.entrada) "entrada" else "salida"
                        is Resultado.Rechazo -> "error"
                        else -> "aviso"
                    })
                }
            },
            publicar = { vista = it },
        )
        m
    }

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

        val res = vista.resultado
        val tono: Color? = when (res) {
            null -> null
            is Resultado.Registrando -> Colores.Azul
            is Resultado.Marcado -> if (res.entrada) Colores.Menta else Colores.Azul
            is Resultado.Rechazo -> Colores.Rojo
            else -> Colores.Azul
        }
        Box(
            Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Color(0xFF2A3B52))
                .border(3.dp, tono ?: Color.Transparent, RoundedCornerShape(24.dp)),
        ) {
            Camara(dueño) { bmp -> motor.cuadro(bmp, System.currentTimeMillis()) }
            GuiaYEsquinas(ok = vista.fase == Fase.RETO && vista.encuadre == Encuadre.OK)

            // Velo del resultado + icono.
            val veloAlfa by animateFloatAsState(if (tono != null) 1f else 0f, tween(250), label = "velo")
            if (veloAlfa > 0f && tono != null) {
                Box(Modifier.matchParentSize().graphicsLayer { alpha = veloAlfa }.background(tono.copy(alpha = .38f)), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(86.dp).clip(CircleShape).background(tono), contentAlignment = Alignment.Center) {
                        if (res is Resultado.Registrando) CircularProgressIndicator(color = Color.White, strokeWidth = 4.dp, modifier = Modifier.size(44.dp))
                        else Text(
                            when (res) { is Resultado.Rechazo -> "✕"; is Resultado.Pendiente -> "⏱"; is Resultado.YaRegistrada -> "i"; else -> "✓" },
                            color = Color.White, fontSize = 42.sp, fontWeight = FontWeight.Bold, fontFamily = Sora,
                        )
                    }
                }
            }

            // Arriba: instrucción y reloj.
            Box(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent))).padding(12.dp)) {
                Pildora(
                    when {
                        vista.fase != Fase.RETO -> "AsistencIA"
                        vista.encuadre == Encuadre.LEJOS -> "Acércate un poco"
                        vista.encuadre == Encuadre.CERCA -> "Aléjate un poco"
                        else -> "Parpadea 👁"
                    },
                    Modifier.align(Alignment.CenterStart),
                )
                Pildora(SimpleDateFormat("HH:mm", Locale.getDefault()).format(ahora), Modifier.align(Alignment.CenterEnd))
            }

            // Centro: invitación cuando no hay nadie.
            if (vista.fase == Fase.REPOSO) {
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Acércate para marcar", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, fontFamily = Sora)
                    Text("tu asistencia", color = Color.White.copy(alpha = .85f), fontSize = 17.sp, fontFamily = Sora)
                }
            }

            // Abajo: avance del reto, o el resultado.
            if (vista.fase == Fase.RETO) {
                val avance by animateFloatAsState(vista.progreso / 100f, tween(200), label = "avance")
                LinearProgressIndicator(
                    progress = { avance }, color = Colores.Menta, trackColor = Color.White.copy(alpha = .25f),
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(22.dp).height(6.dp).clip(RoundedCornerShape(50)),
                )
            }
            if (res != null && tono != null) {
                val (etiqueta, titulo, sub) = when (res) {
                    is Resultado.Registrando -> Triple("Reconocido", res.nombre, "Registrando…")
                    is Resultado.Marcado -> if (res.entrada) Triple("ENTRADA", "¡Hola, ${res.nombre}!", "Entrada registrada · ${res.hora}")
                        else Triple("SALIDA", "¡Hasta luego, ${res.nombre}!", "Salida registrada · ${res.hora}" + (res.trabajadoSeg?.let { " · hoy ${duracion(it)}" } ?: ""))
                    is Resultado.YaRegistrada -> Triple("Ya registrada", res.nombre, "Tu ${res.tipo.ifBlank { "marcación" }} de las ${res.hora} ya quedó registrada")
                    is Resultado.Pendiente -> Triple("Sin conexión", res.nombre, "Se enviará sola al volver la red")
                    is Resultado.Prueba -> Triple("Modo prueba", "Sí, es ${res.nombre}", "No se registró ninguna marcación")
                    is Resultado.Rechazo -> Triple("✕ No registrado", res.nombre ?: "Intenta de nuevo", res.motivo)
                }
                Column(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000)))).padding(18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Etiqueta(etiqueta, tono)
                    Spacer(Modifier.height(6.dp))
                    Text(titulo, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center, fontFamily = Sora)
                    Text(sub, color = Color.White.copy(alpha = .85f), fontSize = 13.sp, textAlign = TextAlign.Center, fontFamily = Sora)
                }
            }
        }

        // Pie: privacidad, pendientes y el panel ⓘ.
        Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (pendientes > 0) "⏱ $pendientes por enviar" else "🔐 No se guardan fotos",
                fontSize = 12.sp, color = Colores.Apagado, modifier = Modifier.weight(1f),
            )
            if (prueba) Etiqueta("PRUEBA", Colores.Apagado)
            TextButton(onClick = { detalle = !detalle }) { Text(if (detalle) "Ocultar ⓘ" else "ⓘ", color = Colores.Apagado) }
        }
        if (detalle) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Modo prueba (no registra marcaciones)", fontSize = 13.sp, color = Colores.Tinta, modifier = Modifier.weight(1f))
                Switch(checked = prueba, onCheckedChange = { prueba = it; almacen.modoPrueba = it })
            }
            Text(
                "$ultimaDecision\numbral $UMBRAL · margen $MARGEN · $info",
                fontSize = 11.sp, color = Colores.Apagado,
            )
        }
    }
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
                    if (ahora - ultimo[0] >= 60) {
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
