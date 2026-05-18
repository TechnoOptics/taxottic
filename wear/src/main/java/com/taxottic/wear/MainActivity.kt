package com.taxottic.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

/**
 * The Wear OS app entry — twin of TaxotticWatchApp.swift. Streams the
 * latest WatchSnapshot from the Data Layer into the paged UI and
 * routes every one-gesture action back to the phone.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WatchData.start(this)
        setContent {
            val snap by WatchData.snapshot.collectAsState()
            WearApp(
                snapshot = snap,
                onConfirm = WatchData::confirm,
                onMileage = WatchData::setMileage,
                onAutoApply = WatchData::setAutoApply,
                onClearBadge = WatchData::clearBadge,
            )
        }
    }

    override fun onDestroy() {
        WatchData.stop(this)
        super.onDestroy()
    }
}
