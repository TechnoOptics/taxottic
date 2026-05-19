package com.taxottic.wear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Base64
import android.util.Log
import com.google.android.gms.wearable.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json

/**
 * Wear ↔ phone over the Wearable Data Layer — the Wear OS counterpart
 * of WatchConnectivityManager.swift.
 *
 *  • Inbound: the phone's Capacitor TaxotticWatchBridge plugin pushes
 *    the WatchSnapshot JSON via DataClient on path "/watch/snapshot".
 *  • Outbound: a one-gesture decision is sent back via MessageClient
 *    on "/watch/action"; the phone forwards it to the SAME
 *    /api/push/action the notification action uses (no new tax logic).
 *
 * Same JSON contract as lib/watch/types.ts, so phone, iOS watch and
 * Wear watch can never drift.
 *
 * ── Debug relay (default OFF) ────────────────────────────────────
 * Two bare emulators can't run the GMS Data Layer (no Wear OS
 * companion + Play sign-in). To exercise the REAL decode/render and
 * action-send code without it, an opt-in relay mirrors the same
 * bytes over adb. Gated on the system property `debug.twb.relay=="1"`
 * (set via `adb shell setprop`) so it is completely inert in
 * production and on real watches — there GMS is the only path and the
 * prop is never set. The normal onDataChanged()/send() behaviour is
 * unchanged when the prop is unset.
 */
object WatchData : DataClient.OnDataChangedListener {
    private const val SNAPSHOT_PATH = "/watch/snapshot"
    private const val ACTION_PATH = "/watch/action"
    private const val RELAY_SNAP = "com.taxottic.wear.TWB_SNAP"
    private const val TAG = "TWBRelay"
    private val json = Json { ignoreUnknownKeys = true }

    private val _snapshot = MutableStateFlow(WatchSnapshot.EMPTY)
    val snapshot: StateFlow<WatchSnapshot> = _snapshot

    private var appContext: Context? = null
    private var relayRx: BroadcastReceiver? = null

    /** True only when `adb shell setprop debug.twb.relay 1` was run.
     *  Reflection (SystemProperties is hidden) — any failure → OFF. */
    private fun relayEnabled(): Boolean = runCatching {
        val sp = Class.forName("android.os.SystemProperties")
        sp.getMethod("get", String::class.java)
            .invoke(null, "debug.twb.relay") == "1"
    }.getOrDefault(false)

    fun start(context: Context) {
        appContext = context.applicationContext
        Wearable.getDataClient(context).addListener(this)
        // Drain whatever the phone last published (cold start).
        Wearable.getDataClient(context).dataItems.addOnSuccessListener { buf ->
            buf.forEach { item ->
                if (item.uri.path == SNAPSHOT_PATH) decode(item)
            }
            buf.release()
        }
        if (relayEnabled()) registerRelay()
    }

    fun stop(context: Context) {
        Wearable.getDataClient(context).removeListener(this)
        relayRx?.let {
            runCatching { context.applicationContext.unregisterReceiver(it) }
            relayRx = null
        }
    }

    override fun onDataChanged(events: DataEventBuffer) {
        events.forEach { e ->
            if (e.type == DataEvent.TYPE_CHANGED &&
                e.dataItem.uri.path == SNAPSHOT_PATH
            ) decode(e.dataItem)
        }
    }

    private fun decode(item: DataItem) {
        val raw = runCatching {
            DataMapItem.fromDataItem(item).dataMap.getString("snapshot")
        }.getOrNull() ?: return
        decodeJson(raw)
    }

    /** Single decode path shared by GMS and the relay so the watch
     *  renders byte-identically no matter which transport carried it. */
    private fun decodeJson(raw: String) {
        runCatching {
            _snapshot.value =
                json.decodeFromString(WatchSnapshot.serializer(), raw)
        }
    }

    /** Server-pull (PairManager) feeds the SAME snapshot the Data
     *  Layer feeds — one source of truth, whichever transport is
     *  live. Last write wins; both run the identical decoder. */
    fun applyRemoteSnapshot(raw: String) = decodeJson(raw)

    private fun registerRelay() {
        val ctx = appContext ?: return
        relayRx = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                val b64 = i.getStringExtra("snap") ?: return
                val jsonStr = runCatching {
                    String(Base64.decode(b64, Base64.NO_WRAP))
                }.getOrNull() ?: return
                decodeJson(jsonStr)
            }
        }
        val filter = IntentFilter(RELAY_SNAP)
        // adb `am broadcast` is the shell uid → receiver must be
        // exported. Flag only on API 33+ (emulators/watches are newer).
        if (Build.VERSION.SDK_INT >= 33) {
            ctx.registerReceiver(relayRx, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            ctx.registerReceiver(relayRx, filter)
        }
        Log.i(TAG, "relay receiver registered (debug.twb.relay=1)")
    }

    /** Fire-and-forget to every connected node (the phone). */
    private fun send(payload: String) {
        if (relayEnabled()) Log.i(TAG, "ACT $payload")
        val ctx = appContext ?: return
        Wearable.getNodeClient(ctx).connectedNodes.addOnSuccessListener { nodes ->
            nodes.forEach { n ->
                Wearable.getMessageClient(ctx)
                    .sendMessage(n.id, ACTION_PATH, payload.toByteArray())
            }
        }
    }

    fun confirm(item: WatchSnapshot.Confirm, left: Boolean) {
        send("""{"type":"confirm","kind":"${item.kind}","id":"${item.id}","decision":"${if (left) "left" else "right"}"}""")
        _snapshot.value = _snapshot.value.copy(
            confirmations = _snapshot.value.confirmations.filterNot { it.id == item.id },
        )
    }

    fun setMileage(on: Boolean) {
        send("""{"type":"mileage","action":"${if (on) "start" else "stop"}"}""")
        _snapshot.value = _snapshot.value.copy(
            mileage = _snapshot.value.mileage.copy(trackingActive = on),
        )
    }

    fun setAutoApply(on: Boolean) {
        send("""{"type":"autoApply","value":"${if (on) "on" else "off"}"}""")
        _snapshot.value = _snapshot.value.copy(
            mileage = _snapshot.value.mileage.copy(autoApplyBusiness = on),
        )
    }

    fun clearBadge() {
        _snapshot.value = _snapshot.value.copy(newBadgeCode = null)
    }

    /** Quick-capture: hand off to the phone's voice/camera expense
     *  capture (lib/watch/bridge.ts routes "open" → foreground). */
    fun requestCapture() {
        send("""{"type":"open","route":"expense-capture"}""")
    }
}
