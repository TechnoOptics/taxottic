// Canonical app-store identifiers and links for Taxottic's native apps.
// Single source of truth so the download banner, footer badges, structured
// data (JSON-LD), and metadata all agree.
//
// iOS App ID and Android package are fixed store identities; see
// android/app/build.gradle (applicationId) and App Store Connect.

export const IOS_APP_ID = "6767039803";
export const ANDROID_PACKAGE = "com.taxottic.app";

export const APP_STORE_URL = `https://apps.apple.com/app/id${IOS_APP_ID}`;
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
