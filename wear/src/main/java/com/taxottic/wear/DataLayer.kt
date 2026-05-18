package com.taxottic.wear

import android.content.Context
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
 */
object WatchData : DataClient.OnDataChangedListener {
    private const val SNAPSHOT_PATH = "/watch/snapshot"
    private const val ACTION_PATH = "/watch/action"
    private val json = Json { ignoreUnknownKeys = true }

    private val _snapshot = MutableStateFlow(WatchSnapshot.EMPTY)
    val snapshot: StateFlow<WatchSnapshot> = _snapshot

    private var appContext: Context? = null

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
    }

    fun stop(context: Context) {
        Wearable.getDataClient(context).removeListener(this)
    }

    override fun onDataChanged(events: DataEventBuffer) {
        events.forEach { e ->
            if (e.type == DataEvent.TYPE_CHANGED &&
                e.dataItem.uri.path == SNAPSHOT_PATH
            ) decode(e.dataItem)
        }
    }

    private fun decode(item: DataItem) {
        runCatching {
            val raw = DataMapItem.fromDataItem(item)
                .dataMap.getString("snapshot") ?: return
            _snapshot.value = json.decodeFromString(WatchSnapshot.serializer(), raw)
        }
    }

    /** Fire-and-forget to every connected node (the phone). */
    private fun send(payload: String) {
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
}
