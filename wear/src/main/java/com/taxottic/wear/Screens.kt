package com.taxottic.wear

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * The dial + the bezel. Pages are turned with the rotating bezel /
 * rotary crown; a luminous gold arc around the rim advances as you go
 * — the "scroll bezel". Same blue gradient as the app, gold the only
 * accent. Twin of ContentView.swift.
 */
@Composable
fun WearApp(
    snapshot: WatchSnapshot,
    onConfirm: (WatchSnapshot.Confirm, Boolean) -> Unit,
    onMileage: (Boolean) -> Unit,
    onAutoApply: (Boolean) -> Unit,
    onClearBadge: () -> Unit,
) {
    val pageCount = 5
    val pager = rememberPagerState { pageCount }
    val scope = rememberCoroutineScope()
    val fr = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { fr.requestFocus() } }

    // Smoothly-tracked scroll position for the bezel (0f‥1f).
    val rawProgress =
        (pager.currentPage + pager.currentPageOffsetFraction) /
            (pageCount - 1).coerceAtLeast(1)
    val progress by animateFloatAsState(
        rawProgress.coerceIn(0f, 1f), tween(450), label = "bezel"
    )

    GemstoneBackground {
        Box(
            Modifier
                .fillMaxSize()
                // Rotating bezel / rotary crown turns the pages.
                .onRotaryScrollEvent { e ->
                    scope.launch {
                        val next = (pager.currentPage +
                            if (e.verticalScrollPixels > 0) 1 else -1)
                            .coerceIn(0, pageCount - 1)
                        pager.animateScrollToPage(next)
                    }
                    true
                }
                .focusRequester(fr)
                .focusable(),
        ) {
            VerticalPager(
                state = pager,
                modifier = Modifier.fillMaxSize().padding(26.dp),
            ) { page ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    when (page) {
                        0 -> HeroScreen(snapshot)
                        1 -> ForecastScreen(snapshot.forecast)
                        2 -> ConfirmScreen(snapshot.confirmations, onConfirm)
                        3 -> MileageScreen(snapshot.mileage, onMileage, onAutoApply)
                        else -> GoalsScreen(snapshot.goals)
                    }
                }
            }

            // The gold scroll-bezel, drawn on the rim above everything.
            GoldBezel(progress)

            snapshot.newBadgeCode?.let {
                MedalCelebration(snapshot.latestBadge?.title ?: "New medal", onClearBadge)
            }
        }
    }
}

/** A faint full gold rail + a bright gold arc that grows and slowly
 *  rotates with scroll progress — a Rolex-style turning bezel. */
@Composable
private fun GoldBezel(progress: Float) {
    Canvas(Modifier.fillMaxSize()) {
        val stroke = 7.dp.toPx()
        val inset = stroke / 2f + 1.5f
        val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
        val topLeft = androidx.compose.ui.geometry.Offset(inset, inset)
        // Engraved rail.
        drawArc(
            color = Brand.gold.copy(alpha = 0.16f),
            startAngle = 0f, sweepAngle = 360f, useCenter = false,
            topLeft = topLeft, size = arcSize,
            style = androidx.compose.ui.graphics.drawscope.Stroke(stroke),
        )
        // Travelling gold sweep — starts at 12 o'clock, grows clockwise,
        // and the brushed sheen rotates a touch as it fills.
        rotate(degrees = progress * 22f) {
            drawArc(
                brush = Brand.goldSheen,
                startAngle = -90f,
                sweepAngle = (360f * progress).coerceAtLeast(6f),
                useCenter = false,
                topLeft = topLeft, size = arcSize,
                style = androidx.compose.ui.graphics.drawscope.Stroke(
                    stroke,
                    cap = androidx.compose.ui.graphics.StrokeCap.Round,
                ),
            )
        }
    }
}

@Composable
private fun Eyebrow(text: String) = Text(
    text.uppercase(), color = Brand.gold, fontSize = 11.sp,
    letterSpacing = 2.sp, fontWeight = FontWeight.SemiBold,
)

@Composable
private fun HeroScreen(s: WatchSnapshot) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center) {
            val anim by animateFloatAsState(
                s.taxReadinessPct / 100f, tween(1000), label = "gauge"
            )
            CircularProgressIndicator(
                progress = anim,
                modifier = Modifier.size(108.dp),
                strokeWidth = 7.dp,
                indicatorColor = Brand.goldBright,
                trackColor = Brand.ink700,
            )
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("${s.taxReadinessPct}%", color = Brand.goldBright,
                    fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text("tax-ready", color = Brand.creamMuted, fontSize = 11.sp)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(s.ytdDeductionCents.usd0(), color = Brand.goldBright,
            fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text("deductions · ≈${s.estimatedTaxSavedCents.usd0()} saved",
            color = Brand.creamMuted, fontSize = 11.sp)
        if (s.streakDays > 0) {
            Spacer(Modifier.height(6.dp))
            Text("· ${s.streakDays}-day streak ·",
                color = Brand.gold, fontSize = 11.sp)
        }
    }
}

@Composable
private fun ForecastScreen(f: WatchSnapshot.Forecast?) {
    Column(Modifier.jewelCard(), horizontalAlignment = Alignment.CenterHorizontally) {
        Eyebrow("Live forecast")
        if (f == null) {
            Spacer(Modifier.height(8.dp))
            Text("Your forecast updates\non your phone",
                color = Brand.creamMuted, fontSize = 12.sp,
                textAlign = TextAlign.Center)
        } else {
            val owe = f.netCents >= 0
            Text(if (owe) "Projected owed" else "Projected refund",
                color = Brand.creamMuted, fontSize = 11.sp)
            Text(abs(f.netCents).usd0(), color = Brand.goldBright,
                fontSize = 30.sp, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Stat("${f.effectiveRatePct}%", "Eff. rate")
                Stat(f.ytdIncomeCents.usd0(), "YTD income")
            }
            Text(f.label, color = Brand.creamMuted, fontSize = 10.sp)
        }
    }
}

@Composable
private fun Stat(value: String, label: String) =
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = Brand.cream, fontSize = 14.sp,
            fontWeight = FontWeight.Bold)
        Text(label, color = Brand.creamMuted, fontSize = 9.sp)
    }

@Composable
private fun ConfirmScreen(
    items: List<WatchSnapshot.Confirm>,
    onConfirm: (WatchSnapshot.Confirm, Boolean) -> Unit,
) {
    if (items.isEmpty()) {
        Column(Modifier.jewelCard(), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("✓", color = Brand.goldBright, fontSize = 30.sp)
            Text("All caught up", color = Brand.cream, fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold)
        }
        return
    }
    val item = items.first()
    var dx by remember(item.id) { mutableStateOf(0f) }
    Column(
        Modifier
            .jewelCard()
            .graphicsLayer { translationX = dx; rotationZ = dx / 22f }
            .pointerInput(item.id) {
                detectHorizontalDragGestures(
                    onDragEnd = {
                        when {
                            dx < -90f -> onConfirm(item, true)
                            dx > 90f -> onConfirm(item, false)
                        }
                        dx = 0f
                    },
                ) { _, drag -> dx += drag }
            },
    ) {
        Eyebrow(item.kind)
        Text(item.title, color = Brand.cream, fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold)
        Text(item.subtitle, color = Brand.creamMuted, fontSize = 11.sp)
        Spacer(Modifier.height(4.dp))
        Row(Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween) {
            Text("◀ ${item.leftLabel}", color = Brand.creamMuted, fontSize = 11.sp)
            Text("${item.rightLabel} ▶", color = Brand.creamMuted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun MileageScreen(
    m: WatchSnapshot.Mileage,
    onMileage: (Boolean) -> Unit,
    onAutoApply: (Boolean) -> Unit,
) {
    Column(Modifier.jewelCard()) {
        Eyebrow(if (m.trackingActive) "Tracking drives" else "Mileage")
        Text("%.1f mi today".format(m.todayMiles), color = Brand.cream,
            fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Text("${m.todayDeductionCents.usd2()} deduction",
            color = Brand.creamMuted, fontSize = 11.sp)
        ToggleChip(
            checked = m.trackingActive,
            onCheckedChange = onMileage,
            label = { Text("Auto-track", color = Brand.cream) },
            toggleControl = { Switch(checked = m.trackingActive) },
        )
        ToggleChip(
            checked = m.autoApplyBusiness,
            onCheckedChange = onAutoApply,
            label = { Text("Auto-apply business", color = Brand.cream) },
            toggleControl = { Switch(checked = m.autoApplyBusiness) },
        )
    }
}

@Composable
private fun GoalsScreen(goals: List<WatchSnapshot.Goal>) {
    Column(Modifier.jewelCard()) {
        Eyebrow("Goals")
        if (goals.isEmpty()) {
            Text("Set a savings goal on your phone.",
                color = Brand.creamMuted, fontSize = 11.sp)
        } else goals.take(3).forEach { g ->
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween) {
                Text(g.title, color = Brand.cream, fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold)
                Text("${(g.progress * 100).toInt()}%", color = Brand.gold,
                    fontSize = 11.sp)
            }
            Box(
                Modifier.fillMaxWidth().height(5.dp)
                    .clip(RoundedCornerShape(3.dp)).background(Brand.ink700),
            ) {
                Box(
                    Modifier.fillMaxWidth(g.progress.coerceIn(0f, 1f))
                        .height(5.dp).clip(RoundedCornerShape(3.dp))
                        .background(Brand.goldBright),
                )
            }
        }
    }
}

@Composable
private fun MedalCelebration(title: String, onDone: () -> Unit) {
    LaunchedEffect(title) { kotlinx.coroutines.delay(2600); onDone() }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("🏅", fontSize = 44.sp)
            Eyebrow("Medal earned")
            Text(title, color = Brand.cream, fontSize = 16.sp,
                fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        }
    }
}
