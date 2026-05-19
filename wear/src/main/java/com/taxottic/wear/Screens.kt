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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
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
import kotlin.math.cos
import kotlin.math.sin

/**
 * The dial + the bezel, finished like a fine watch:
 *  • a FLUTED gold bezel (Datejust signature) whose lit sector tracks
 *    scroll progress and turns slightly,
 *  • a guilloché sunburst behind the content,
 *  • an engraved chapter-ring of tick indices,
 * over the app's blue gradient. The rotating bezel / Digital Crown
 * turns the pages — and on the Set-Aside tool it BECOMES a value dial.
 */
@Composable
fun WearApp(
    snapshot: WatchSnapshot,
    onConfirm: (WatchSnapshot.Confirm, Boolean) -> Unit,
    onMileage: (Boolean) -> Unit,
    onAutoApply: (Boolean) -> Unit,
    onCapture: () -> Unit,
    onClearBadge: () -> Unit,
) {
    val pageCount = 6
    val setAsideIndex = 5
    val pager = rememberPagerState { pageCount }
    val scope = rememberCoroutineScope()
    val fr = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { fr.requestFocus() } }

    // Crown "Set-Aside" value (whole dollars). Stepped by the crown
    // when that page is showing.
    var setAside by remember { mutableStateOf(2_000) }
    val ratePct = snapshot.forecast?.effectiveRatePct?.takeIf { it > 0 } ?: 25

    val onSetAsidePage = pager.currentPage == setAsideIndex
    val pageProg = (pager.currentPage + pager.currentPageOffsetFraction) /
        (pageCount - 1).coerceAtLeast(1)
    val targetBezel = if (onSetAsidePage)
        (setAside / 20_000f).coerceIn(0f, 1f) else pageProg.coerceIn(0f, 1f)
    val bezel by animateFloatAsState(targetBezel, tween(420), label = "bezel")

    GemstoneBackground {
        Box(
            Modifier
                .fillMaxSize()
                .onRotaryScrollEvent { e ->
                    val dir = if (e.verticalScrollPixels > 0) 1 else -1
                    if (pager.currentPage == setAsideIndex) {
                        setAside = (setAside + dir * 100).coerceIn(0, 20_000)
                    } else scope.launch {
                        pager.animateScrollToPage(
                            (pager.currentPage + dir).coerceIn(0, pageCount - 1)
                        )
                    }
                    true
                }
                .focusRequester(fr)
                .focusable(),
        ) {
            // Guilloché sunburst + engraved chapter ring (under content).
            RolexDial()

            VerticalPager(
                state = pager,
                modifier = Modifier.fillMaxSize().padding(30.dp),
            ) { page ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    when (page) {
                        0 -> HeroScreen(snapshot, onCapture)
                        1 -> ForecastScreen(snapshot.forecast)
                        2 -> ConfirmScreen(snapshot.confirmations, onConfirm)
                        3 -> MileageScreen(snapshot.mileage, onMileage, onAutoApply)
                        4 -> GoalsScreen(snapshot.goals)
                        else -> SetAsideScreen(setAside, ratePct)
                    }
                }
            }

            // The fluted gold bezel, drawn on the rim above everything.
            FlutedBezel(bezel)

            snapshot.newBadgeCode?.let {
                MedalCelebration(snapshot.latestBadge?.title ?: "New medal", onClearBadge)
            }
        }
    }
}

/** Faint gold sunburst rays + an engraved chapter ring of ticks —
 *  the hand-finished dial texture, kept very subtle. */
@Composable
private fun RolexDial() {
    Canvas(Modifier.fillMaxSize()) {
        val cx = size.width / 2f
        val cy = size.height / 2f
        val r = size.minDimension / 2f
        // Sunburst: 90 hairline rays from the centre, barely there.
        for (i in 0 until 90) {
            val a = Math.toRadians(i * 4.0)
            drawLine(
                color = Brand.gold.copy(alpha = if (i % 2 == 0) 0.045f else 0.02f),
                start = Offset(cx, cy),
                end = Offset(cx + (cos(a) * r).toFloat(), cy + (sin(a) * r).toFloat()),
                strokeWidth = 1.2f,
            )
        }
        // Chapter ring: 60 ticks just inside the bezel; every 5th longer.
        val ringR = r - 16.dp.toPx()
        for (i in 0 until 60) {
            val a = Math.toRadians(i * 6.0 - 90)
            val long = i % 5 == 0
            val inner = ringR - (if (long) 9.dp.toPx() else 4.dp.toPx())
            drawLine(
                color = Brand.gold.copy(alpha = if (long) 0.5f else 0.22f),
                start = Offset(cx + (cos(a) * ringR).toFloat(), cy + (sin(a) * ringR).toFloat()),
                end = Offset(cx + (cos(a) * inner).toFloat(), cy + (sin(a) * inner).toFloat()),
                strokeWidth = if (long) 2.4f else 1.4f,
            )
        }
    }
}

/** Datejust-style fluted bezel: radial gold flutes around the rim;
 *  the sector covered by `progress` is lit (polished) and the whole
 *  ring turns a touch as it fills — a real rotating bezel. */
@Composable
private fun FlutedBezel(progress: Float) {
    Canvas(Modifier.fillMaxSize()) {
        val cx = size.width / 2f
        val cy = size.height / 2f
        val outer = size.minDimension / 2f - 2f
        val inner = outer - 9.dp.toPx()
        val flutes = 72
        rotate(degrees = progress * 16f) {
            for (i in 0 until flutes) {
                val frac = i.toFloat() / flutes
                val lit = frac <= progress
                val a = Math.toRadians(i * (360.0 / flutes) - 90)
                val edge = if (i % 2 == 0) outer else outer - 2.5f
                val col = when {
                    lit && i % 2 == 0 -> Brand.goldBright
                    lit -> Brand.gold
                    i % 2 == 0 -> Brand.goldDeep.copy(alpha = 0.5f)
                    else -> Brand.goldShadow.copy(alpha = 0.35f)
                }
                drawLine(
                    color = col,
                    start = Offset(cx + (cos(a) * inner).toFloat(), cy + (sin(a) * inner).toFloat()),
                    end = Offset(cx + (cos(a) * edge).toFloat(), cy + (sin(a) * edge).toFloat()),
                    strokeWidth = 3.4f,
                    cap = StrokeCap.Round,
                )
            }
        }
        // A bright polished arc riding the lit flutes for sheen.
        drawArc(
            brush = Brand.goldSheen,
            startAngle = -90f,
            sweepAngle = (360f * progress).coerceAtLeast(4f),
            useCenter = false,
            topLeft = Offset(cx - inner, cy - inner),
            size = Size(inner * 2, inner * 2),
            style = Stroke(2.2f, cap = StrokeCap.Round),
        )
    }
}

@Composable
private fun Eyebrow(text: String) = Text(
    text.uppercase(), color = Brand.gold, fontSize = 11.sp,
    letterSpacing = 2.sp, fontWeight = FontWeight.SemiBold,
)

@Composable
private fun HeroScreen(s: WatchSnapshot, onCapture: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center) {
            val anim by animateFloatAsState(
                s.taxReadinessPct / 100f, tween(1000), label = "gauge"
            )
            CircularProgressIndicator(
                progress = anim,
                modifier = Modifier.size(104.dp),
                strokeWidth = 7.dp,
                indicatorColor = Brand.goldBright,
                trackColor = Brand.ink700,
            )
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("${s.taxReadinessPct}%", color = Brand.goldBright,
                    fontSize = 26.sp, fontWeight = FontWeight.Bold)
                Text("tax-ready", color = Brand.creamMuted, fontSize = 11.sp)
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(s.ytdDeductionCents.usd0(), color = Brand.goldBright,
            fontSize = 21.sp, fontWeight = FontWeight.Bold)
        Text("deductions · ≈${s.estimatedTaxSavedCents.usd0()} saved",
            color = Brand.creamMuted, fontSize = 10.sp)
        Spacer(Modifier.height(8.dp))
        CompactChip(
            onClick = onCapture,
            colors = ChipDefaults.chipColors(
                backgroundColor = Brand.gold, contentColor = Brand.ink950
            ),
            label = { Text("＋ Capture expense", fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold) },
        )
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

/** The crown tool. Turn the bezel/crown → set a payment amount; it
 *  instantly shows the tax reserve at your real effective rate. */
@Composable
private fun SetAsideScreen(amount: Int, ratePct: Int) {
    val reserve = amount * ratePct / 100
    Column(
        Modifier.jewelCard(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Eyebrow("Set aside · turn crown")
        Text("On a payment of", color = Brand.creamMuted, fontSize = 11.sp)
        Text("$" + "%,d".format(amount), color = Brand.cream,
            fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("Set aside", color = Brand.creamMuted, fontSize = 11.sp)
        Text("$" + "%,d".format(reserve), color = Brand.goldBright,
            fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text("for taxes · ~$ratePct% rate", color = Brand.creamMuted,
            fontSize = 10.sp)
    }
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
