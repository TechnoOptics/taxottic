package com.taxottic.wear

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Account pairing + direct server pull for the watch.
 *
 * The user picked "server pull with the phone Data-Layer bridge as
 * fallback" and a short-lived single-use code. Flow:
 *
 *   1. No stored token → POST /api/watch/pair/start, get a deviceId
 *      + a ~120s 6-digit code. We render the code BIG on the
 *      watch face and poll /api/watch/pair/poll.
 *   2. User types the code into Phone → Settings → Devices →
 *      Pair watch → poll returns the 256-bit token exactly once.
 *      We persist it (app-private prefs) and stop showing the code.
 *   3. Paired → GET /api/watch/snapshot with `Authorization: Bearer`
 *      on a cadence, feeding the SAME WatchData snapshot the Data
 *      Layer feeds. If we're offline the Data-Layer push still works,
 *      so this is strictly additive resilience.
 *
 * All network is off the main thread; every failure is swallowed and
 * retried — the watch must never show an error, just stale data.
 */
object PairManager {
    private const val BASE = "https://taxottic.com"
    private const val PREFS = "taxottic.watch.pair"
    private const val K_TOKEN = "token"
    private const val K_DEVICE = "deviceId"

    sealed interface State {
        data object Booting : State
        /**
         * Show this 6-digit code until the phone redeems it. There is
         * no QR any more; pairing is a typed code in Phone Settings.
         */
        data class NeedsPair(val code: String) : State
        data object Paired : State
    }

    private val _state = MutableStateFlow<State>(State.Booting)
    val state: StateFlow<State> = _state

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var prefs: SharedPreferences? = null
    private var loop: Job? = null

    fun start(context: Context) {
        if (loop?.isActive == true) return
        prefs = context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        loop = scope.launch { run() }
    }

    fun stop() {
        loop?.cancel()
        loop = null
    }

    private suspend fun run() {
        val p = prefs ?: return
        var token = p.getString(K_TOKEN, null)
        if (token == null) token = handshake(p)
        if (token != null) _state.value = State.Paired
        while (currentCoroutineContext().isActive && token != null) {
            if (!pull(token)) {
                // 401 → token dead. Forget it and re-pair.
                p.edit().remove(K_TOKEN).apply()
                token = handshake(p)
                if (token != null) _state.value = State.Paired
            }
            delay(60_000)
        }
    }

    /** Loop start → poll until redeemed (or the code expires, then
     *  start over with a fresh code). Returns the watch token. */
    private suspend fun handshake(p: SharedPreferences): String? {
        while (currentCoroutineContext().isActive) {
            val start = httpJson("POST", "$BASE/api/watch/pair/start", null, null)
            val deviceId = start?.optString("deviceId")?.takeIf { it.isNotEmpty() }
            val code = start?.optString("code")?.takeIf { it.isNotEmpty() }
            val ttl = start?.optInt("expiresInSec", 120) ?: 120
            if (deviceId == null || code == null) {
                delay(8_000)
                continue
            }
            p.edit().putString(K_DEVICE, deviceId).apply()
            _state.value = State.NeedsPair(code = code)
            val deadline = System.currentTimeMillis() + ttl * 1000L
            while (currentCoroutineContext().isActive &&
                System.currentTimeMillis() < deadline
            ) {
                delay(3_000)
                val poll = httpJson(
                    "GET",
                    "$BASE/api/watch/pair/poll?deviceId=$deviceId",
                    null, null,
                ) ?: continue
                if (poll.optBoolean("paired", false)) {
                    val tok = poll.optString("token").takeIf { it.isNotEmpty() }
                    if (tok != null) {
                        p.edit().putString(K_TOKEN, tok).apply()
                        return tok
                    }
                }
            }
            // Code expired without a scan — mint a fresh one.
        }
        return null
    }

    /** GET the snapshot with the bearer token; feed WatchData. Returns
     *  false ONLY on an auth failure (caller re-pairs). Network blips
     *  return true (keep the token, try again next tick). */
    private fun pull(token: String): Boolean {
        val (status, body) = httpRaw(
            "GET", "$BASE/api/watch/snapshot", null, token,
        )
        if (status == 401 || status == 403) return false
        if (status in 200..299 && !body.isNullOrBlank()) {
            WatchData.applyRemoteSnapshot(body)
        }
        return true
    }

    // ── tiny HTTP (no OkHttp dep) ────────────────────────────────

    private fun httpJson(
        method: String,
        url: String,
        body: String?,
        bearer: String?,
    ): JSONObject? {
        val (status, raw) = httpRaw(method, url, body, bearer)
        if (status !in 200..299 || raw.isNullOrBlank()) return null
        return runCatching { JSONObject(raw) }.getOrNull()
    }

    private fun httpRaw(
        method: String,
        url: String,
        body: String?,
        bearer: String?,
    ): Pair<Int, String?> {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("Accept", "application/json")
                if (bearer != null) {
                    setRequestProperty("Authorization", "Bearer $bearer")
                }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toByteArray()) }
                }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream
            else conn.errorStream
            val text = stream?.bufferedReader()
                ?.use(BufferedReader::readText)
            status to text
        } catch (t: Throwable) {
            -1 to null
        } finally {
            conn?.disconnect()
        }
    }

}
