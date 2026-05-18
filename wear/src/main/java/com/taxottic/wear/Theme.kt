package com.taxottic.wear

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/**
 * "Midnight & gold" design system — the Wear OS twin of
 * ios/TaxotticWatch/Theme.swift. Same brand navy (#192539) + warm
 * metallic gold so the two watches feel identical.
 */
object Brand {
    val ink900 = Color(0xFF192539) // brand anchor
    val ink950 = Color(0xFF121A2A) // deepest
    val ink800 = Color(0xFF1D2843)
    val ink700 = Color(0xFF243150)

    val goldBright = Color(0xFFF2D896)
    val gold = Color(0xFFD5BB7E)
    val goldDeep = Color(0xFFC4A25D)
    val goldShadow = Color(0xFFA78540)

    val cream = Color(0xFFFBF7E9)
    val creamMuted = Color(0x9EFBF7E9) // ~0.62 alpha

    /** Brushed-gold sweep for rims, the gauge and key numerals. */
    val goldSheen = Brush.linearGradient(
        listOf(goldShadow, goldBright, gold, goldShadow),
    )

    /** Gemstone backdrop: a soft midnight radial so the round face
     *  glows from the centre like a cut stone, not a flat fill. */
    val gemstone = Brush.radialGradient(
        colors = listOf(ink700.copy(alpha = 0.55f), ink950),
    )

    val glass = Brush.verticalGradient(listOf(ink800, ink900))
}

val Figure = FontFamily.Default // tabular look; swap to a serif if bundled

/** Midnight glass + hairline-gold rim — the single most "jewelry"
 *  detail, reused on every card. */
fun Modifier.jewelCard(): Modifier = this
    .clip(RoundedCornerShape(18.dp))
    .background(Brand.glass)
    .padding(12.dp)

@Composable
fun GemstoneBackground(content: @Composable () -> Unit) {
    androidx.compose.foundation.layout.Box(
        Modifier.background(Brand.gemstone),
    ) { content() }
}
