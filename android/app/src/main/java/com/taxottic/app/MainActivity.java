package com.taxottic.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the Wear OS bridge before the WebView bridge boots
        // so window.Capacitor exposes the TaxotticWatchBridge plugin.
        registerPlugin(TaxotticWatchBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
