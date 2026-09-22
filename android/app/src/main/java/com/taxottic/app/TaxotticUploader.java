package com.taxottic.app;

import android.content.Context;
import android.util.Log;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Posts buffered fixes with no JS running.
 *
 * The WebView's flush tick can only drain while the app is alive, and
 * this phone's app is killed nightly: measured over 21 days, the median
 * fix reached the server 24 hours after capture and p90 was 5.9 days.
 * Everything here therefore has to work in a process that started cold
 * from a geofence receiver, with no WebView, no bridge and no JS.
 *
 * Two rules, both learned the hard way in this repository.
 *
 *  1. Consume only after a 2xx. lib/mileage/drain-coverage.ts exists
 *     because two drains posted the same batch, so the server dedupes
 *     on (driver, captured_at, lat, lng). A fix that was posted but not
 *     consumed is a duplicate the server absorbs; a fix consumed but
 *     never posted is a lost drive, and the buffer was the only copy.
 *  2. Never run on the caller's thread. Every caller is a service
 *     lifecycle method on the main thread, and a 30 second read timeout
 *     there is an ANR, which the OS resolves by killing the process
 *     mid-upload. uploadInBackground() is the entry point callers use;
 *     upload() is the blocking worker behind it.
 */
final class TaxotticUploader {

    private static final String TAG = "TaxotticUploader";

    /** Reads the session cookie. A seam so the test needs no WebView. */
    interface CookieSource {
        String cookieFor(String origin);
    }

    /** Performs the POST and returns the status code. A seam for tests. */
    interface Transport {
        int post(String url, String cookie, String body) throws IOException;
    }

    /** Notified on the uploader's own thread when a run finishes. */
    interface Listener {
        void onUploadFinished(Result result);
    }

    static final class Result {
        final int posted;
        final int remaining;
        final String reason;

        Result(int posted, int remaining, String reason) {
            this.posted = posted;
            this.remaining = remaining;
            this.reason = reason;
        }
    }

    private static final int MAX_BATCH = 500;

    /**
     * One thread, owned here, shared by every caller.
     *
     * Single, not pooled, on purpose: two uploads running at once would
     * read overlapping prefixes of the same buffer and post the same
     * fixes twice. Serialising them costs nothing, because the only
     * triggers are a capture ending and a cold start.
     */
    private static final ExecutorService UPLOAD_EXECUTOR = Executors.newSingleThreadExecutor();

    /**
     * The entry point for anything holding a Looper. Returns at once.
     */
    static void uploadInBackground(Context ctx, Listener listener) {
        final Context app = ctx.getApplicationContext();
        UPLOAD_EXECUTOR.execute(() -> {
            Result result = upload(app);
            Log.i(TAG, "upload " + result.reason + " posted=" + result.posted
                    + " remaining=" + result.remaining);
            if (listener != null) listener.onUploadFinished(result);
        });
    }

    /**
     * Blocking. Call from a background thread, or use
     * uploadInBackground().
     */
    static Result upload(Context ctx) {
        return upload(ctx, TaxotticUploader::systemCookie, TaxotticUploader::httpPost);
    }

    static Result upload(Context ctx, CookieSource cookies, Transport transport) {
        String origin = TaxotticGeofenceStore.getUploadOrigin(ctx);
        String companyId = TaxotticGeofenceStore.getUploadCompanyId(ctx);
        if (origin == null || origin.isEmpty() || companyId == null || companyId.isEmpty()) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "no_config");
        }

        // The origin comes from window.location.origin. Today the shell
        // loads taxottic.com over https, but a move to bundled assets
        // would make it capacitor://localhost, and posting to that fails
        // deep inside HttpURLConnection on a thread nobody is watching.
        // Refuse it by name instead, so the heartbeat can say which
        // thing is wrong.
        if (!origin.startsWith("https://") && !origin.startsWith("http://")) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "bad_origin");
        }

        String cookie = cookies.cookieFor(origin);
        // Supabase names every session cookie with an sb- prefix. A
        // cookie string without one is a visitor, not a driver, and
        // posting would just collect 401s.
        if (cookie == null || !cookie.contains("sb-")) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "no_session");
        }

        // The read carries a token naming the exact buffer it saw. The
        // JS drain in lib/mileage/geofence.ts drains the same file from
        // the same process, and without the token a consume expressed as
        // a COUNT can drop lines the other consumer read but never
        // posted. See BUFFER_GENERATION in TaxotticGeofenceStore.
        TaxotticGeofenceStore.BufferRead read =
                TaxotticGeofenceStore.readBufferedFixes(ctx, MAX_BATCH);
        List<JSONObject> fixes = read.fixes;
        if (fixes.isEmpty()) return new Result(0, 0, "empty");

        String body;
        try {
            JSONArray points = new JSONArray();
            for (JSONObject fix : fixes) {
                // Read back through getDouble/getLong rather than
                // forwarding the store's object. isFinitePoint in
                // app/api/mileage/ingest drops a point of the wrong
                // shape SILENTLY, so a store that ever went back to
                // emitting latitude/longitude/time would post 200 and
                // ingest nothing. Here the same mistake throws, and the
                // run reports io_error with the buffer intact.
                JSONObject p = new JSONObject();
                p.put("lat", fix.getDouble("lat"));
                p.put("lng", fix.getDouble("lng"));
                p.put("ts", fix.getLong("ts"));
                points.put(p);
            }
            JSONObject payload = new JSONObject();
            payload.put("companyId", companyId);
            payload.put("points", points);
            // Stored and forwarded by construction. The ingest route
            // documents that these must not have their clock skew
            // corrected, because their lag is the design, not a device
            // whose clock is wrong. Without this, a batch that landed 2
            // to 30 minutes behind receipt is re-stamped to now and the
            // drive is stored a second time under a timestamp the
            // idempotency key cannot recognise.
            payload.put("backlog", true);
            body = payload.toString();
        } catch (Exception e) {
            Log.e(TAG, "Could not build the upload payload", e);
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "io_error");
        }

        int status;
        try {
            status = transport.post(origin + "/api/mileage/ingest", cookie, body);
        } catch (IOException e) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "io_error");
        }

        if (status < 200 || status >= 300) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "http_" + status);
        }

        // Only here, only this many, and only if the buffer is still the
        // one that was read. Everything above returns with the buffer
        // untouched. A refused consume means the JS drain moved the file
        // while this POST was in flight: those points are on the server,
        // ingest dedupes them, and the next run re-reads the real state.
        // The alternative, dropping the count anyway, deletes lines this
        // run never posted.
        boolean consumed = TaxotticGeofenceStore.consumeBuffer(ctx, fixes.size(), read.generation);
        return new Result(
                fixes.size(),
                TaxotticGeofenceStore.countBufferedFixes(ctx),
                consumed ? "ok" : "ok_stale_buffer");
    }

    private static String systemCookie(String origin) {
        try {
            return CookieManager.getInstance().getCookie(origin);
        } catch (Throwable t) {
            // No WebView has been created in this process yet, which is
            // the normal state on a cold geofence start. Report it as
            // no_session rather than crashing the service.
            return null;
        }
    }

    private static int httpPost(String url, String cookie, String body) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setConnectTimeout(15_000);
            c.setReadTimeout(30_000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Cookie", cookie);
            try (OutputStream out = c.getOutputStream()) {
                out.write(body.getBytes("UTF-8"));
            }
            return c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    private TaxotticUploader() {}
}
