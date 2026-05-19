package com.taxottic.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

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
 *
 * ── Debug relay (default OFF) ────────────────────────────────────
 * The GMS Data Layer needs the Wear OS companion app + a Play
 * sign-in, which two bare emulators can't have. To exercise the REAL
 * publish/receive code without that transport, an opt-in relay
 * mirrors the same bytes over adb. It is gated on the system property
 * `debug.twb.relay == "1"` (set via `adb shell setprop`), so it is
 * completely inert in production and on real devices — there, GMS is
 * the only path and the prop is never set. Nothing here changes the
 * normal sync()/onMessageReceived() behaviour when the prop is unset.
 */
@CapacitorPlugin(name = "TaxotticWatchBridge")
public class TaxotticWatchBridgePlugin extends Plugin
        implements MessageClient.OnMessageReceivedListener {

    private static final String SNAPSHOT_PATH = "/watch/snapshot";
    private static final String ACTION_PATH = "/watch/action";

    // Debug-relay intent actions (only ever broadcast by the adb host
    // relay; receivers are registered only when the prop is set).
    private static final String RELAY_ACTION = "com.taxottic.app.TWB_ACTION";
    private static final String RELAY_SIMSNAP = "com.taxottic.app.TWB_SIMSNAP";
    private static final String TAG = "TWBRelay";

    private BroadcastReceiver relayActionRx;
    private BroadcastReceiver relaySimSnapRx;

    /** True only when `adb shell setprop debug.twb.relay 1` was run.
     *  Reflection (SystemProperties is hidden) — any failure → OFF. */
    private static boolean relayEnabled() {
        try {
            Class<?> sp = Class.forName("android.os.SystemProperties");
            Object v = sp.getMethod("get", String.class)
                    .invoke(null, "debug.twb.relay");
            return "1".equals(v);
        } catch (Throwable t) {
            return false;
        }
    }

    @Override
    public void load() {
        try {
            Wearable.getMessageClient(getContext()).addListener(this);
        } catch (Throwable ignored) {
            /* no Play services / Wearable in this binary — no-op */
        }
        if (relayEnabled()) registerRelay();
    }

    @Override
    protected void handleOnDestroy() {
        try {
            Wearable.getMessageClient(getContext()).removeListener(this);
        } catch (Throwable ignored) {
        }
        unregisterRelay();
    }

    /** JS → watch. Publishes the snapshot JSON on the Data Layer. */
    @PluginMethod
    public void sync(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        if (snapshot == null) {
            call.reject("invalid snapshot");
            return;
        }
        publishSnapshot(snapshot.toString(), call);
    }

    /**
     * The one place a WatchSnapshot leaves the phone. Real path is
     * GMS putDataItem; when the relay is on it ALSO emits the bytes
     * to logcat for the adb host to forward (and resolves even if GMS
     * is unavailable, so the emulator demo doesn't look like a
     * failure). `call` may be null for the debug sim-snapshot path.
     */
    private void publishSnapshot(String snapshotJson, PluginCall call) {
        boolean relay = relayEnabled();
        if (relay) {
            Log.i(TAG, "SNAP " + Base64.encodeToString(
                    snapshotJson.getBytes(), Base64.NO_WRAP));
        }
        try {
            PutDataMapRequest req = PutDataMapRequest.create(SNAPSHOT_PATH);
            req.getDataMap().putString("snapshot", snapshotJson);
            // A changing timestamp guarantees the DataItem is treated
            // as changed even if the snapshot bytes repeat.
            req.getDataMap().putLong("ts", System.currentTimeMillis());
            Wearable.getDataClient(getContext())
                    .putDataItem(req.asPutDataRequest().setUrgent())
                    .addOnSuccessListener(r -> {
                        if (call != null) call.resolve();
                    })
                    .addOnFailureListener(e -> {
                        // Relay demo: GMS absent on the emulator is
                        // expected — the relay already carried it.
                        if (call == null) return;
                        if (relay) call.resolve();
                        else call.reject(e.getMessage());
                    });
        } catch (Throwable t) {
            if (call == null) return;
            if (relay) call.resolve();
            else call.reject(t.getMessage());
        }
    }

    /** watch → JS. Forward the one-gesture action verbatim. */
    @Override
    public void onMessageReceived(MessageEvent event) {
        if (event == null || !ACTION_PATH.equals(event.getPath())) {
            return;
        }
        deliverAction(new String(event.getData()));
    }

    /** Shared by the GMS path and the relay receiver — identical
     *  JSON → notifyListeners("action", …) handoff to bridge.ts. */
    private void deliverAction(String jsonStr) {
        // Relay-only positive proof the phone received the watch's
        // selection (the real handoff to bridge.ts is silent). No-op
        // in production — relayEnabled() is false there.
        if (relayEnabled()) Log.i(TAG, "ACTION-IN " + jsonStr);
        try {
            JSONObject in = new JSONObject(jsonStr);
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

    // ── Debug relay plumbing (registered only when prop is set) ──

    private void registerRelay() {
        try {
            relayActionRx = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent i) {
                    String msg = i.getStringExtra("msg");
                    if (msg != null) deliverAction(msg);
                }
            };
            relaySimSnapRx = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent i) {
                    // Represents "the phone produced a snapshot" —
                    // routed through the exact real publish path.
                    // base64 so the JSON survives adb/am shell quoting
                    // (symmetric with the watch's TWB_SNAP receiver).
                    String b64 = i.getStringExtra("snap");
                    if (b64 == null) return;
                    try {
                        String snap = new String(
                                Base64.decode(b64, Base64.NO_WRAP));
                        publishSnapshot(snap, null);
                    } catch (Throwable ignored) {
                    }
                }
            };
            register(relayActionRx, RELAY_ACTION);
            register(relaySimSnapRx, RELAY_SIMSNAP);
            Log.i(TAG, "relay receivers registered (debug.twb.relay=1)");
        } catch (Throwable t) {
            Log.i(TAG, "relay register failed: " + t.getMessage());
        }
    }

    private void register(BroadcastReceiver rx, String action) {
        IntentFilter f = new IntentFilter(action);
        // adb `am broadcast` comes from the shell uid → must be
        // exported. Flag only exists on API 33+ (emulators are newer).
        if (Build.VERSION.SDK_INT >= 33) {
            getContext().registerReceiver(
                    rx, f, Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(rx, f);
        }
    }

    private void unregisterRelay() {
        for (BroadcastReceiver rx : new BroadcastReceiver[]{
                relayActionRx, relaySimSnapRx}) {
            if (rx == null) continue;
            try {
                getContext().unregisterReceiver(rx);
            } catch (Throwable ignored) {
            }
        }
        relayActionRx = null;
        relaySimSnapRx = null;
    }
}
