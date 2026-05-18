package com.taxottic.wear

import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.LayoutElementBuilders.*
import androidx.wear.protolayout.ResourceBuilders.Resources
import androidx.wear.protolayout.TimelineBuilders.Timeline
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders.Tile
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Wear OS Tile — the glanceable surface equivalent of the iOS
 * WidgetKit complication. Shows YTD deduction + tax-readiness from
 * the last synced snapshot. (Static scaffold; a production tile would
 * read the persisted snapshot and refresh via getTileResources.)
 */
class TaxotticTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<Tile> {
        val s = WatchData.snapshot.value
        val gold = argb(0xFFF2D896.toInt())
        val cream = argb(0xFFFBF7E9.toInt())

        val layout = Box.Builder()
            .addContent(
                Column.Builder()
                    .addContent(text("TAXOTTIC", gold, 12))
                    .addContent(text(s.ytdDeductionCents.usd0(), gold, 28))
                    .addContent(text("deductions", cream, 12))
                    .addContent(text("${s.taxReadinessPct}% tax-ready", cream, 12))
                    .build(),
            )
            .build()

        return Futures.immediateFuture(
            Tile.Builder()
                .setResourcesVersion("1")
                .setTileTimeline(
                    Timeline.fromLayoutElement(layout),
                )
                .build(),
        )
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<Resources> =
        Futures.immediateFuture(Resources.Builder().setVersion("1").build())

    private fun text(t: String, color: androidx.wear.protolayout.ColorBuilders.ColorProp, size: Int) =
        Text.Builder()
            .setText(t)
            .setFontStyle(
                FontStyle.Builder().setColor(color)
                    .setSize(androidx.wear.protolayout.DimensionBuilders.sp(size.toFloat()))
                    .build(),
            )
            .build()
}
