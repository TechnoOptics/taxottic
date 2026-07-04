package com.taxottic.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Locale;

/**
 * Home-screen forecast widget. Renders the last snapshot the app pushed
 * via TaxotticWidgetBridgePlugin (SharedPreferences) — the widget never
 * talks to the network itself, so it shows the figures as of the last
 * app open, with a relative "Updated …" stamp.
 *
 * Adapts to plan/context for free: the server-computed snapshot is
 * already personal- or business-scoped, and omits `forecast` for free /
 * signed-out / not-yet-computed states, which we render as a branded
 * "open the app" prompt instead of a fabricated number.
 */
public class TaxotticForecastWidget extends AppWidgetProvider {

    /** Repaint every placed instance — called by the bridge plugin
     *  right after it persists a fresh snapshot. */
    static void refreshAll(Context ctx) {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            ComponentName cn =
                    new ComponentName(ctx, TaxotticForecastWidget.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            for (int id : ids) render(ctx, mgr, id);
        } catch (Throwable ignored) {
            /* never let a widget repaint crash the host app */
        }
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
    }

    private static void render(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(
                ctx.getPackageName(), R.layout.widget_forecast);

        // Tap anywhere → open the app.
        Intent open = ctx.getPackageManager()
                .getLaunchIntentForPackage(ctx.getPackageName());
        if (open != null) {
            PendingIntent pi = PendingIntent.getActivity(
                    ctx, 0, open,
                    PendingIntent.FLAG_UPDATE_CURRENT
                            | PendingIntent.FLAG_IMMUTABLE);
            v.setOnClickPendingIntent(R.id.widget_root, pi);
        }

        SharedPreferences prefs = ctx.getSharedPreferences(
                TaxotticWidgetBridgePlugin.PREFS, Context.MODE_PRIVATE);
        String json = prefs.getString(
                TaxotticWidgetBridgePlugin.KEY_SNAPSHOT, null);
        long ts = prefs.getLong(TaxotticWidgetBridgePlugin.KEY_TS, 0L);

        boolean rendered = false;
        if (json != null) {
            try {
                JSONObject snap = new JSONObject(json);
                JSONObject f = snap.optJSONObject("forecast");
                if (f != null) {
                    long netCents = f.optLong("netCents", 0);
                    int ratePct = f.optInt("effectiveRatePct", 0);
                    String label = f.optString("label", "Projected estimate");
                    boolean owe = netCents >= 0;

                    v.setTextViewText(R.id.widget_hero,
                            formatMoney(Math.abs(netCents)));
                    v.setTextViewText(R.id.widget_caption,
                            (owe ? "Projected tax owed" : "Projected refund")
                                    + " · " + ratePct + "% rate");
                    v.setTextViewText(R.id.widget_label, label);

                    long ytdDed = snap.optLong("ytdDeductionCents", 0);
                    int outstanding = snap.optInt("outstandingCount", 0);
                    v.setTextViewText(R.id.widget_stat1,
                            formatMoney(ytdDed) + " deductions");
                    v.setTextViewText(R.id.widget_stat2,
                            outstanding > 0
                                    ? (outstanding + " to review")
                                    : "All caught up");

                    v.setViewVisibility(R.id.widget_stats, View.VISIBLE);
                    v.setViewVisibility(R.id.widget_empty, View.GONE);
                    v.setTextViewText(R.id.widget_updated, relTime(ts));
                    rendered = true;
                }
            } catch (Throwable ignored) {
                /* malformed snapshot — fall through to the empty state */
            }
        }

        if (!rendered) {
            // No forecast yet: free tier, signed out, or not computed.
            v.setTextViewText(R.id.widget_hero, "Taxottic");
            v.setTextViewText(R.id.widget_caption, "Your tax forecast");
            v.setTextViewText(R.id.widget_label, "");
            v.setViewVisibility(R.id.widget_stats, View.GONE);
            v.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            v.setTextViewText(R.id.widget_empty,
                    "Open Taxottic to see your forecast");
            v.setTextViewText(R.id.widget_updated, "");
        }

        mgr.updateAppWidget(id, v);
    }

    private static String formatMoney(long cents) {
        long dollars = Math.round(cents / 100.0);
        return "$" + String.format(Locale.US, "%,d", dollars);
    }

    private static String relTime(long ts) {
        if (ts <= 0) return "";
        long mins = (System.currentTimeMillis() - ts) / 60000L;
        if (mins < 1) return "Updated just now";
        if (mins < 60) return "Updated " + mins + "m ago";
        long hrs = mins / 60;
        if (hrs < 24) return "Updated " + hrs + "h ago";
        return "Updated " + (hrs / 24) + "d ago";
    }
}
