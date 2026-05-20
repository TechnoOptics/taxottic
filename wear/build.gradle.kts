// Wear OS module. NOT wired into android/settings.gradle on purpose
// (see wear/README.md) so the working Android release pipeline is
// untouched until this is intentionally adopted.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.taxottic.wear"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.taxottic.app"
        minSdk = 30 // Wear OS 3+
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.00")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material:material-icons-core")

    // Wear Compose (Material + Foundation + Pager).
    implementation("androidx.wear.compose:compose-material:1.4.0")
    implementation("androidx.wear.compose:compose-foundation:1.4.0")

    // Wear Tiles (the complication-equivalent).
    implementation("androidx.wear.tiles:tiles:1.4.0")
    implementation("androidx.wear.protolayout:protolayout:1.2.0")
    implementation("com.google.guava:guava:33.3.0-android")

    // Phone ↔ watch Data Layer.
    implementation("com.google.android.gms:play-services-wearable:18.2.0")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    // Background pairing/poll/snapshot-pull off the main thread.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
