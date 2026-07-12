package com.taxottic.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // AndroidManifest assigns AppTheme.NoActionBarLaunch (Theme.SplashScreen,
        // windowBackground = @drawable/splash) to this Activity for cold start.
        // That theme must be swapped for the real post-splash theme here, or the
        // Activity's window keeps the splash drawable as its background for its
        // entire lifetime — invisible while the WebView covers it, but it leaks
        // through anything that inherits windowBackground with no background of
        // its own, e.g. the native <select> dropdown's AlertDialog rendered the
        // splash logo behind its option rows. See
        // https://developer.android.com/develop/ui/views/launch/splash-screen/migrate
        setTheme(R.style.AppTheme_NoActionBar);

        // Register the native bridges before the WebView bridge boots so
        // window.Capacitor exposes them: the Wear OS watch bridge and the
        // home-screen widget bridge.
        registerPlugin(TaxotticWatchBridgePlugin.class);
        registerPlugin(TaxotticWidgetBridgePlugin.class);
        registerPlugin(TaxotticDeviceStatusPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
