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
import java.util.Collections;
import java.util.List;
import java.util.Map;
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
        /**
         * @return the Cookie header value, or null when the jar holds
         *         nothing for this origin.
         * @throws CookieJarUnavailable when the WebView provider itself
         *         will not load, which is a different problem from an
         *         empty jar and wants a different answer.
         */
        String cookieFor(String origin);
    }

    /**
     * Writes rotated cookies back. A seam so the test needs no WebView.
     *
     * Not an optional nicety. lib/supabase/middleware.ts calls getUser()
     * BEFORE its /api/ early return, so a POST carrying an expired access
     * token makes the server refresh and ROTATE the refresh token, which
     * this project has rotation enabled for: 174 refresh tokens over 7
     * days across 3 sessions, 171 of them revoked. The new pair comes
     * back as Set-Cookie. A plain HttpURLConnection has no CookieHandler,
     * so dropping them leaves the WebView jar holding a token the server
     * has just revoked, and the driver is signed out at the next app
     * open, into the silent 401 loop that once cost a full day of drives.
     * That is strictly worse than not uploading at all.
     */
    interface CookieSink {
        void store(String origin, List<String> setCookies);
    }

    /** The WebView cookie provider would not load at all. */
    static final class CookieJarUnavailable extends RuntimeException {
        CookieJarUnavailable(Throwable cause) {
            super(cause);
        }
    }

    /** What the server said: the status, and any cookies it rotated. */
    static final class Response {
        final int status;
        final List<String> setCookies;

        Response(int status, List<String> setCookies) {
            this.status = status;
            this.setCookies = setCookies == null ? Collections.emptyList() : setCookies;
        }
    }

    /** Performs the POST. A seam for tests. */
    interface Transport {
        Response post(String url, String cookie, String body) throws IOException;
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
        return upload(ctx, TaxotticUploader::systemCookie, TaxotticUploader::storeCookies,
                TaxotticUploader::httpPost);
    }

    static Result upload(Context ctx, CookieSource cookies, CookieSink sink, Transport transport) {
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

        String cookie;
        try {
            cookie = cookies.cookieFor(origin);
        } catch (CookieJarUnavailable e) {
            // Distinct from no_session on purpose. An empty jar means
            // "this driver is signed out", and the answer is to sign in
            // again. A provider that will not load in a WebView-less
            // process means the whole design does not work on this
            // phone, and the answer is to stop shipping it. One word for
            // both is how a dead feature reads as a user problem.
            Log.e(TAG, "The WebView cookie provider would not load", e);
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "no_cookie_jar");
        }
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

        Response response;
        try {
            response = transport.post(origin + "/api/mileage/ingest", cookie, body);
        } catch (IOException e) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "io_error");
        }

        int status = response.status;
        if (status < 200 || status >= 300) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "http_" + status);
        }

        // Before the consume, because a session this process has just
        // caused the server to rotate is more expensive to lose than a
        // duplicate upload. If the write back does not happen the
        // WebView is left holding a revoked refresh token.
        sink.store(origin, response.setCookies);

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
            // getInstance() loads the WebView provider without a WebView
            // instance, which is the normal state on a cold geofence
            // start. If that fails the design does not work on this
            // phone, and saying so is worth more than crashing the
            // service or pretending the driver is signed out.
            throw new CookieJarUnavailable(t);
        }
    }

    /**
     * Write rotated cookies back into the jar the WebView reads, then
     * flush.
     *
     * The flush is called even when the server rotated nothing: it is
     * the only thing that puts this process's cookie state on disk, and
     * this process is usually minutes from being killed.
     */
    private static void storeCookies(String origin, List<String> setCookies) {
        try {
            CookieManager manager = CookieManager.getInstance();
            for (String value : setCookies) {
                if (value != null && !value.isEmpty()) manager.setCookie(origin, value);
            }
            manager.flush();
        } catch (Throwable t) {
            Log.e(TAG, "Could not write back the rotated session cookie", t);
        }
    }

    private static Response httpPost(String url, String cookie, String body) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod("POST");
            // A 301 or 302 in front of the route would otherwise be
            // followed AS A GET, return 200 from an HTML page, and the
            // buffer would be consumed with nothing ingested. Off, so a
            // redirect surfaces as http_301 and the fixes stay put.
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15_000);
            c.setReadTimeout(30_000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Cookie", cookie);
            try (OutputStream out = c.getOutputStream()) {
                out.write(body.getBytes("UTF-8"));
            }
            return new Response(c.getResponseCode(), setCookiesFrom(c));
        } finally {
            c.disconnect();
        }
    }

    /**
     * Header names are matched case insensitively rather than looked up
     * by key, because the map's case sensitivity is an implementation
     * detail of whichever HTTP stack the platform hands back.
     */
    private static List<String> setCookiesFrom(HttpURLConnection c) {
        for (Map.Entry<String, List<String>> header : c.getHeaderFields().entrySet()) {
            if (header.getKey() != null && header.getKey().equalsIgnoreCase("Set-Cookie")) {
                return header.getValue();
            }
        }
        return Collections.emptyList();
    }

    private TaxotticUploader() {}
}
