package com.taxottic.wear

import kotlinx.serialization.Serializable

/**
 * The watch payload — Kotlin mirror of lib/watch/types.ts and the
 * Swift `struct WatchSnapshot`. Decoded from the JSON the phone sends
 * over the Wearable Data Layer. Every collection defaults to empty so
 * a partial sync never crashes a screen.
 */
@Serializable
data class WatchSnapshot(
    val taxReadinessPct: Int = 0,
    val ytdDeductionCents: Int = 0,
    val estimatedTaxSavedCents: Int = 0,
    val streakDays: Int = 0,
    val forecast: Forecast? = null,
    val confirmations: List<Confirm> = emptyList(),
    val deductions: List<Deduction> = emptyList(),
    val goals: List<Goal> = emptyList(),
    val mileage: Mileage = Mileage(),
    val latestBadge: Badge? = null,
    val newBadgeCode: String? = null,
    val companyId: String? = null,
    val reward: Reward? = null,
) {
    @Serializable
    data class Forecast(
        val label: String,
        /** Positive = owe, negative = refund. */
        val netCents: Int,
        val effectiveRatePct: Int,
        val ytdIncomeCents: Int,
    )

    @Serializable
    data class Confirm(
        val id: String,
        val kind: String, // trip | expense | income
        val title: String,
        val subtitle: String,
        val amountCents: Int,
        val leftLabel: String, // swipe-left commits this
        val rightLabel: String, // swipe-right commits this
    )

    @Serializable
    data class Deduction(
        val name: String,
        val amountCents: Int,
        val captured: Boolean,
    )

    @Serializable
    data class Goal(
        val id: String,
        val title: String,
        val savedCents: Int,
        val targetCents: Int,
    ) {
        val progress: Float
            get() = if (targetCents > 0)
                (savedCents.toFloat() / targetCents).coerceIn(0f, 1f) else 0f
    }

    @Serializable
    data class Mileage(
        val trackingActive: Boolean = false,
        val autoApplyBusiness: Boolean = false,
        val todayMiles: Double = 0.0,
        val todayDeductionCents: Int = 0,
    )

    @Serializable
    data class Badge(val title: String, val symbol: String)

    @Serializable
    data class Reward(val title: String, val detail: String)

    companion object {
        val EMPTY = WatchSnapshot()
    }
}

/** Cents → "$1,243" (no fraction) for headline figures. */
fun Int.usd0(): String = "$" + "%,d".format(this / 100)

/** Cents → "$18.40" for line items. */
fun Int.usd2(): String = "$" + "%,.2f".format(this / 100.0)
