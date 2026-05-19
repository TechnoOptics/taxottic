package com.taxottic.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.Wearable;

import org.json.JSONObject;

import java.util.Iterator;

/**
 * Phone-side bridge to the Wear OS app over the Wearable Data Layer.
 *
 *  - sync({ snapshot })  → publishes the WatchSnapshot JSON on
 *    /watch/snapshot (the watch's WatchData decodes + renders it).
 *  - inbound /watch/action messages from the watch → notifyListeners
 *    ("action", …) which lib/watch/bridge.ts forwards to
 *    /api/watch/confirm (reclassify trip / setTxCategory|ignoreTx).
 *
 * Java (the Capacitor app module is Java-only — no Kotlin toolchain
 * added to the release build). Every Wearable call is guarded so the
 * app never crashes on a binary/device without Play services or a
 * paired watch; lib/watch/bridge.ts additionally gates on
 * isPluginAvailable (the #69 graceful-degradation lesson).
 */
@CapacitorPlugin(name = "TaxotticWatchBridge")
public class TaxotticWatchBridgePlugin extends Plugin
        implements MessageClient.OnMessageReceivedListener {

    private static final String SNAPSHOT_PATH = "/watch/snapshot";
    private static final String ACTION_PATH = "/watch/action";

    @Override
    public void load() {
        try {
            Wearable.getMessageClient(getContext()).addListener(this);
        } catch (Throwable ignored) {
            /* no Play services / Wearable in this binary — no-op */
        }
    }

    @Override
    protected void handleOnDestroy() {
        try {
            Wearable.getMessageClient(getContext()).removeListener(this);
        } catch (Throwable ignored) {
        }
    }

    /** JS → watch. Publishes the snapshot JSON on the Data Layer. */
    @PluginMethod
    public void sync(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        if (snapshot == null) {
            call.reject("invalid snapshot");
            return;
        }
        try {
            PutDataMapRequest req = PutDataMapRequest.create(SNAPSHOT_PATH);
            req.getDataMap().putString("snapshot", snapshot.toString());
            // A changing timestamp guarantees the DataItem is treated
            // as changed even if the snapshot bytes repeat.
            req.getDataMap().putLong("ts", System.currentTimeMillis());
            Wearable.getDataClient(getContext())
                    .putDataItem(req.asPutDataRequest().setUrgent())
                    .addOnSuccessListener(r -> call.resolve())
                    .addOnFailureListener(e -> call.reject(e.getMessage()));
        } catch (Throwable t) {
            call.reject(t.getMessage());
        }
    }

    /** watch → JS. Forward the one-gesture action verbatim. */
    @Override
    public void onMessageReceived(MessageEvent event) {
        if (event == null || !ACTION_PATH.equals(event.getPath())) {
            return;
        }
        try {
            JSONObject in = new JSONObject(new String(event.getData()));
            JSObject out = new JSObject();
            Iterator<String> keys = in.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                out.put(k, in.get(k));
            }
            notifyListeners("action", out);
        } catch (Throwable ignored) {
            /* malformed message — drop it */
        }
    }
}
