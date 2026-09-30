package co.asistencia.kiosco

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.material3.Text
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Paleta de la app (la misma del kiosco web, el panel y la landing). */
object Colores {
    val Marino = Color(0xFF13294B)
    val Marino2 = Color(0xFF1E3A5F)
    val Azul = Color(0xFF2B6CB0)
    val Menta = Color(0xFF2FBF8F)
    val MentaClaro = Color(0xFF9FDCCA)
    val Rojo = Color(0xFFB3403A)
    val Fondo = Color(0xFFF2F6FC)
    val Tinta = Color(0xFF14233A)
    val Apagado = Color(0xFF7A8AA0)
    val Borde = Color(0xFFDDE6F1)
}

/** El icono «Presente ✓» (el mismo SVG de public/icon.svg), dibujado. */
@Composable
fun LogoApp(tam: Dp = 40.dp) {
    Canvas(Modifier.size(tam)) {
        val s = size.width / 64f
        drawRoundRect(
            brush = Brush.verticalGradient(listOf(Color(0xFF2B6CB0), Color(0xFF172E4C))),
            cornerRadius = CornerRadius(14 * s, 14 * s),
        )
        // translate(3.2 3.2) scale(0.9) del SVG
        fun p(x: Float, y: Float) = Offset((3.2f + x * 0.9f) * s, (3.2f + y * 0.9f) * s)
        drawCircle(Color.White, radius = 20 * 0.9f * s, center = p(32f, 31f), style = Stroke(width = 4.6f * 0.9f * s))
        drawCircle(Color.White, radius = 2.2f * 0.9f * s, center = p(25.4f, 27f))
        drawCircle(Color.White, radius = 2.2f * 0.9f * s, center = p(38.6f, 27f))
        val check = Path().apply {
            val a = p(24f, 37f); val b = p(30f, 43f); val c = p(42f, 31f)
            moveTo(a.x, a.y); lineTo(b.x, b.y); lineTo(c.x, c.y)
        }
        drawPath(check, Colores.MentaClaro, style = Stroke(width = 4.4f * 0.9f * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/** «ASISTENCIA» con el «IA» en azul, como en la web. */
@Composable
fun NombreApp(tam: TextUnit = 20.sp, color: Color = Colores.Tinta) {
    Text(
        buildAnnotatedString {
            append("ASISTENC")
            withStyle(SpanStyle(color = Colores.Azul)) { append("IA") }
        },
        color = color, fontSize = tam, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp,
    )
}

@Composable
fun MarcaFila(logo: Dp = 40.dp, texto: TextUnit = 20.sp) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        LogoApp(logo)
        Spacer(Modifier.width(10.dp))
        NombreApp(texto)
    }
}
