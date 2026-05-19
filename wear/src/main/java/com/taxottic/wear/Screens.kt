package com.taxottic.wear

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
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
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.text.TextStyle
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

            // Rewarding moments — a new medal, a goal reached, or a
            // new deduction category unlocked. One-shot overlay.
            snapshot.newBadgeCode?.let {
                Celebration("🏅", "Medal earned",
                    snapshot.latestBadge?.title ?: "New medal", onClearBadge)
            }
            snapshot.reward?.let { r ->
                var seen by remember(r) { mutableStateOf(false) }
                if (!seen) Celebration("✦", r.title, r.detail) { seen = true }
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

/** A single thin gold bezel: a faint full rail with a brushed-gold
 *  arc that grows from 12 o'clock and turns slightly as you scroll —
 *  a fine rotating bezel, nothing thick. */
@Composable
private fun FlutedBezel(progress: Float) {
    Canvas(Modifier.fillMaxSize()) {
        val cx = size.width / 2f
        val cy = size.height / 2f
        val r = size.minDimension / 2f - 4f
        val tl = Offset(cx - r, cy - r)
        val sz = Size(r * 2, r * 2)
        // Engraved rail.
        drawArc(
            color = Brand.gold.copy(alpha = 0.14f),
            startAngle = 0f, sweepAngle = 360f, useCenter = false,
            topLeft = tl, size = sz, style = Stroke(3.5f),
        )
        // Travelling brushed-gold arc — turns a touch as it fills.
        rotate(degrees = progress * 16f) {
            drawArc(
                brush = Brand.goldSheen,
                startAngle = -90f,
                sweepAngle = (360f * progress).coerceAtLeast(4f),
                useCenter = false,
                topLeft = tl, size = sz,
                style = Stroke(3.5f, cap = StrokeCap.Round),
            )
        }
    }
}

@Composable
private fun Eyebrow(text: String) = Text(
    text.uppercase(), color = Brand.gold, fontSize = 11.sp,
    letterSpacing = 2.sp, fontWeight = FontWeight.SemiBold,
)

/** The maker's signature — like the brand name under 12 o'clock on
 *  a fine watch dial: tracked brushed-gold wordmark + the house gold
 *  flourish (dot · bar · dot, same motif as the app icon). */
@Composable
private fun Wordmark() {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "TAXOTTIC",
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 4.5.sp,
            style = TextStyle(brush = Brand.brushedGold),
        )
        Spacer(Modifier.height(3.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Box(Modifier.size(3.dp).clip(RoundedCornerShape(50))
                .background(Brand.goldDeep))
            Box(Modifier.width(34.dp).height(2.dp)
                .clip(RoundedCornerShape(50)).background(Brand.gold))
            Box(Modifier.size(3.dp).clip(RoundedCornerShape(50))
                .background(Brand.goldDeep))
        }
    }
}

@Composable
private fun HeroScreen(s: WatchSnapshot, onCapture: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Wordmark()
        Spacer(Modifier.height(8.dp))
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
                Text("${s.taxReadinessPct}%", fontSize = 26.sp,
                    fontWeight = FontWeight.Bold,
                    style = TextStyle(brush = Brand.brushedGold))
                Text("tax-ready", color = Brand.creamMuted, fontSize = 11.sp)
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(s.ytdDeductionCents.usd0(), fontSize = 21.sp,
            fontWeight = FontWeight.Bold,
            style = TextStyle(brush = Brand.brushedGold))
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
    Column(
        Modifier.jewelCard(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Eyebrow("Live forecast")
        if (f == null) {
            Spacer(Modifier.height(10.dp))
            Text("Your forecast updates\non your phone",
                color = Brand.creamMuted, fontSize = 12.sp,
                textAlign = TextAlign.Center)
            return@Column
        }
        val owe = f.netCents >= 0
        // The headline: a big brushed-gold figure inside a thin gold
        // rate-ring — the showpiece. The ring fills with the
        // effective rate, so the number sits in its own gauge.
        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(top = 4.dp)) {
            val ring by animateFloatAsState(
                (f.effectiveRatePct / 100f).coerceIn(0f, 1f),
                tween(900), label = "rate"
            )
            Canvas(Modifier.size(132.dp)) {
                val s = 6.dp.toPx()
                drawArc(
                    color = Brand.gold.copy(alpha = 0.14f),
                    startAngle = 0f, sweepAngle = 360f, useCenter = false,
                    style = Stroke(s),
                )
                drawArc(
                    brush = Brand.goldSheen,
                    startAngle = -90f,
                    sweepAngle = (360f * ring).coerceAtLeast(6f),
                    useCenter = false,
                    style = Stroke(s, cap = StrokeCap.Round),
                )
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (owe) "you'll owe" else "refund",
                    color = Brand.creamMuted, fontSize = 10.sp,
                    letterSpacing = 1.5.sp)
                Text(abs(f.netCents).usd0(), fontSize = 26.sp,
                    fontWeight = FontWeight.Bold,
                    style = TextStyle(brush = Brand.brushedGold))
                Text("${f.effectiveRatePct}% eff. rate",
                    color = Brand.gold, fontSize = 10.sp)
            }
        }
        Spacer(Modifier.height(6.dp))
        Text("on ${f.ytdIncomeCents.usd0()} income · ${f.label}",
            color = Brand.creamMuted, fontSize = 10.sp,
            textAlign = TextAlign.Center)
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
        Text("$" + "%,d".format(reserve), fontSize = 34.sp,
            fontWeight = FontWeight.Bold,
            style = TextStyle(brush = Brand.brushedGold))
        Text("for taxes · ~$ratePct% rate", color = Brand.creamMuted,
            fontSize = 10.sp)
    }
}

/** Animated directional chevrons — a "swipe this way" motion
 *  graphic. Three chevrons ripple toward the edge; the active side
 *  (while dragging that way) brightens. The zone is also tappable as
 *  a quiet reliability fallback. */
@Composable
private fun SwipeHint(
    pointLeft: Boolean,
    label: String,
    active: Boolean,
    onTap: () -> Unit,
) {
    val t = rememberInfiniteTransition(label = "hint")
    val phase by t.animateFloat(
        0f, 3f,
        infiniteRepeatable(tween(1100), RepeatMode.Restart),
        label = "phase",
    )
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable(
            indication = null,
            interactionSource = remember { MutableInteractionSource() },
        ) { onTap() },
    ) {
        Row {
            val order = if (pointLeft) listOf(2, 1, 0) else listOf(0, 1, 2)
            order.forEach { i ->
                val lead = (phase.toInt() % 3)
                val a = if (active) 1f
                    else 0.25f + 0.6f * (if (i == lead) 1f else 0f)
                Text(
                    if (pointLeft) "‹" else "›",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = (if (active) Brand.goldBright else Brand.gold)
                        .copy(alpha = a),
                )
            }
        }
        Text(label, fontSize = 9.sp,
            fontWeight = FontWeight.SemiBold, maxLines = 1,
            color = if (active) Brand.goldBright else Brand.creamMuted)
    }
}

@Composable
private fun ConfirmScreen(
    items: List<WatchSnapshot.Confirm>,
    onConfirm: (WatchSnapshot.Confirm, Boolean) -> Unit,
) {
    if (items.isEmpty()) {
        Column(
            Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("✓", color = Brand.goldBright, fontSize = 34.sp)
            Text("All caught up", color = Brand.cream, fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold)
        }
        return
    }
    val item = items.first()
    var dx by remember(item.id) { mutableStateOf(0f) }
    val draggingLeft = dx < -8f
    val draggingRight = dx > 8f

    Box(
        Modifier
            .fillMaxSize()
            .draggable(
                orientation = Orientation.Horizontal,
                state = rememberDraggableState { delta -> dx += delta },
                onDragStopped = {
                    when {
                        dx < -90f -> onConfirm(item, true)
                        dx > 90f -> onConfirm(item, false)
                    }
                    dx = 0f
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        val tint = when {
            draggingLeft -> Brand.goldBright
            draggingRight -> Color(0xFF8898BD)
            else -> Color.Transparent
        }
        // hint │ centered content │ hint — no overlap, content gets
        // the full middle. Hints are pure motion graphics.
        Row(
            Modifier.fillMaxSize().padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SwipeHint(true, item.leftLabel, draggingLeft) {
                onConfirm(item, true)
            }
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .weight(1f)
                    .graphicsLayer { translationX = dx; rotationZ = dx / 26f },
            ) {
                Eyebrow(item.kind)
                Spacer(Modifier.height(3.dp))
                Text(item.title, color = Brand.cream, fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center, maxLines = 2)
                if (item.amountCents > 0) {
                    Spacer(Modifier.height(3.dp))
                    Text(item.amountCents.usd2(), fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        style = TextStyle(brush = Brand.brushedGold))
                }
                if (kotlin.math.abs(dx) > 55f) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        (if (draggingLeft) item.leftLabel else item.rightLabel)
                            .uppercase(),
                        color = Brand.ink950, fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .background(tint, RoundedCornerShape(50))
                            .padding(horizontal = 10.dp, vertical = 3.dp),
                    )
                }
            }
            SwipeHint(false, item.rightLabel, draggingRight) {
                onConfirm(item, false)
            }
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
private fun Celebration(
    glyph: String,
    eyebrow: String,
    title: String,
    onDone: () -> Unit,
) {
    LaunchedEffect(eyebrow, title) {
        kotlinx.coroutines.delay(2600); onDone()
    }
    Box(
        Modifier.fillMaxSize().background(Brand.ink950.copy(alpha = 0.86f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(glyph, fontSize = 44.sp)
            Eyebrow(eyebrow)
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                style = TextStyle(brush = Brand.brushedGold))
        }
    }
}
