// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.3.4"),
        .package(name: "CapacitorApp", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/@capacitor/app"),
        .package(name: "CapacitorBrowser", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/@capacitor/browser"),
        .package(name: "CapacitorCamera", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/@capacitor/camera"),
        .package(name: "CapacitorHaptics", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/@capacitor/haptics"),
        .package(name: "CapacitorNetwork", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/@capacitor/network"),
        .package(name: "CapacitorPreferences", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/@capacitor/preferences"),
        .package(name: "CapacitorPushNotifications", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/@capacitor/push-notifications"),
        .package(name: "CapacitorSplashScreen", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/@capacitor/splash-screen"),
        .package(name: "CapacitorStatusBar", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/@capacitor/status-bar"),
        .package(name: "CapgoBackgroundGeolocation", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/@capgo/background-geolocation"),
        .package(name: "CapacitorPluginSafeArea", path: "../../../../../../../../../../Users/technooptics/Projects/taxottic/node_modules/capacitor-plugin-safe-area")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorCamera", package: "CapacitorCamera"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorNetwork", package: "CapacitorNetwork"),
                .product(name: "CapacitorPreferences", package: "CapacitorPreferences"),
                .product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar"),
                .product(name: "CapgoBackgroundGeolocation", package: "CapgoBackgroundGeolocation"),
                .product(name: "CapacitorPluginSafeArea", package: "CapacitorPluginSafeArea")
            ]
        )
    ]
)
