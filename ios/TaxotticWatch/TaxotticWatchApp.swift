//  TaxotticWatchApp.swift
//  Taxottic Watch — Phase 4 (optional) native watchOS companion.
//
//  STATUS: scaffold. This source is complete and idiomatic but is NOT
//  yet wired into the Xcode project — adding a watchOS target edits
//  ios/App/App.xcodeproj/project.pbxproj, which is intentionally NOT
//  hand-edited (a malformed pbxproj would break the working iOS
//  release pipeline). See ios/TaxotticWatch/README.md for the exact
//  Xcode steps to add the target; once added, these files compile and
//  ship as-is.
//
//  The phone app is a Capacitor remote-WebView shell, so the watch
//  cannot read the web app directly. Data arrives over
//  WatchConnectivity from a tiny phone-side bridge (also described in
//  the README) and via the existing push pipeline (actionable
//  notifications mirror to the watch with zero watch code — this app
//  is purely the *richer-than-a-notification* glanceable layer the
//  spec calls Phase 4).

import SwiftUI

@main
struct TaxotticWatchApp: App {
    @StateObject private var model = WatchModel.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
    }
}
