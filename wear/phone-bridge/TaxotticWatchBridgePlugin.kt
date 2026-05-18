// PHONE-SIDE Capacitor plugin (Android) — add to the Capacitor app
// target (android/app), NOT the Wear module. The Android twin of
// ios/TaxotticWatch/TaxotticWatchBridgePlugin.swift. Same JS contract
// ("TaxotticWatchBridge"), so lib/watch/bridge.ts already drives it —
// once compiled in, the Wear watch shows live data with no web change.
//
// STATUS: scaffold. Not registered in MainActivity / the Android
// project on purpose, so the working android-release pipeline is
// untouched until intentionally adopted (see wear/README.md).

package com.taxottic.app

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.MessageClient
import org.json.JSONObject

@CapacitorPlugin(name = "TaxotticWatchBridge")
class TaxotticWatchBridgePlugin : Plugin() {

    private val snapshotPath = "/watch/snapshot"
    private val actionPath = "/watch/action"

    private val listener = MessageClient.OnMessageReceivedListener { msg ->
        if (msg.path == actionPath) {
            // Hand the inbound one-gesture action to JS;
            // lib/watch/bridge.ts forwards it to /api/push/action.
            val data = JSONObject(String(msg.data))
            val ret = com.getcapacitor.JSObject()
            data.keys().forEach { k -> ret.put(k, data.get(k)) }
            notifyListeners("action", ret)
        }
    }

    override fun load() {
        Wearable.getMessageClient(context).addListener(listener)
    }

    override fun handleOnDestroy() {
        Wearable.getMessageClient(context).removeListener(listener)
    }

    /** JS → watch. Publishes the WatchSnapshot JSON on the Data Layer;
     *  the Wear app's WatchData decodes + renders it. */
    @PluginMethod
    fun sync(call: PluginCall) {
        val snapshot = call.getObject("snapshot")
            ?: run { call.reject("invalid snapshot"); return }
        val req = PutDataMapRequest.create(snapshotPath).apply {
            dataMap.putString("snapshot", snapshot.toString())
            dataMap.putLong("ts", System.currentTimeMillis())
        }
        Wearable.getDataClient(context)
            .putDataItem(req.asPutDataRequest().setUrgent())
            .addOnSuccessListener { call.resolve() }
            .addOnFailureListener { e -> call.reject(e.message) }
    }
}
