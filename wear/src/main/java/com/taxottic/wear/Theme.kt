package com.taxottic.wear

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/**
 * "Midnight & gold" — the Wear OS twin of ios/TaxotticWatch/Theme.swift.
 * The face uses the SAME blue gradient as the app; gold is the only
 * accent. Designed like a fine watch: the screen is the dial, the rim
 * is the bezel.
 */
object Brand {
    val ink900 = Color(0xFF192539) // brand anchor
    val ink950 = Color(0xFF121A2A) // deepest
    val ink800 = Color(0xFF1D2843)
    val ink700 = Color(0xFF243150)
    val ink600 = Color(0xFF2F3E63)

    val goldBright = Color(0xFFF2D896)
    val gold = Color(0xFFD5BB7E)
    val goldDeep = Color(0xFFC4A25D)
    val goldShadow = Color(0xFFA78540)
    // Deep anodized edge — the "dark gradient tint" the gold sinks
    // toward, so it reads as machined metal, not flat paint.
    val goldDark = Color(0xFF6E561F)
    val goldRoot = Color(0xFF4A3A16)

    val cream = Color(0xFFFBF7E9)
    val creamMuted = Color(0x9EFBF7E9)

    /** The app's blue gradient — a top-lit sweep from a lighter slate
     *  down into the deepest midnight, so the dial reads as a single
     *  polished surface, modern and deep. */
    val appGradient = Brush.linearGradient(
        0.0f to ink600,
        0.40f to ink900,
        1.0f to ink950,
        start = Offset(0f, 0f),
        end = Offset(0f, Float.POSITIVE_INFINITY),
    )

    /** Soft centre glow layered over the gradient — the "gemstone"
     *  catch-light. */
    val centerGlow = Brush.radialGradient(
        listOf(ink700.copy(alpha = 0.45f), Color.Transparent),
    )

    /** Bezel sweep — now dark-biased: one bright catch-light band on
     *  a deep anodized field, like light raking across machined
     *  metal rather than flat gold. */
    val goldSheen = Brush.sweepGradient(
        listOf(goldRoot, goldDark, goldShadow, gold, goldBright, gold, goldShadow, goldDark, goldRoot),
    )

    /** Fine brushed-aluminium grain for gold numerals/surfaces: a
     *  tight near-horizontal gradient that alternates close gold
     *  tones so it shimmers like an anisotropic brushed finish, with
     *  an overall dark tint (more deep/shadow than bright). */
    val brushedGold = Brush.linearGradient(
        0.00f to goldDark, 0.07f to goldShadow, 0.13f to gold,
        0.19f to goldDeep, 0.26f to goldBright, 0.33f to goldDeep,
        0.41f to gold, 0.49f to goldShadow, 0.57f to goldDark,
        0.64f to goldShadow, 0.72f to gold, 0.80f to goldBright,
        0.88f to goldDeep, 1.00f to goldDark,
        start = Offset(0f, 0f),
        end = Offset(140f, 9f),
        tileMode = androidx.compose.ui.graphics.TileMode.Mirror,
    )

    val glass = Brush.verticalGradient(listOf(ink800, ink900))
}

val Figure = FontFamily.Default

// No box. Content lands directly on the guilloché dial — just
// breathing room so it clears the fluted bezel + chapter ring.
fun Modifier.jewelCard(): Modifier = this.padding(horizontal = 18.dp, vertical = 6.dp)

/** App-matching blue gradient + centre glow. */
@Composable
fun GemstoneBackground(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(Brand.appGradient)) {
        Box(Modifier.fillMaxSize().background(Brand.centerGlow)) { content() }
    }
}
