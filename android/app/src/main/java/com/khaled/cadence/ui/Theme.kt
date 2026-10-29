package com.khaled.cadence.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

val Accent = Color(0xFFFF7A50)
val Accent2 = Color(0xFFE8417A)
val AccentGradient = Brush.linearGradient(listOf(Color(0xFFFF8A5C), Accent2))
val Bg = Color(0xFF0E0E11)
val Bg2 = Color(0xFF15151A)
val Bg3 = Color(0xFF1D1D24)
val Bg4 = Color(0xFF272731)
val Muted = Color(0xFFA3A1AB)

private val scheme = darkColorScheme(
    primary = Accent,
    onPrimary = Color.White,
    secondary = Accent2,
    background = Bg,
    onBackground = Color(0xFFF3F1EE),
    surface = Bg2,
    onSurface = Color(0xFFF3F1EE),
    surfaceVariant = Bg3,
    onSurfaceVariant = Muted,
    surfaceContainer = Bg3,
    surfaceContainerHigh = Bg4,
    outline = Color(0xFF2C2C36),
)

@Composable
fun CadenceTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = scheme, content = content)
