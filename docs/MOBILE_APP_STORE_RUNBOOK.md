# Mobile app store submission runbook

Operational steps for shipping the Taxottic Capacitor shell to the Apple App Store + Google Play. The code is ready; this is the human/compliance work.

## What's already built

- **Capacitor 8.3.4** with iOS + Android platforms wired
- **`capacitor.config.ts`** points the WebView at `https://taxottic.com` (live-URL strategy)
- **iOS deployment target 17.0** + **Android compileSdk/targetSdk 36**
- Native value-add already configured: Camera, Push Notifications, Preferences, Haptics, StatusBar, SplashScreen
- Splash screen + status-bar theming tuned to the brand

## Apple App Store

### 1. Apple Developer Program enrollment ($99/year)

- Sign up at developer.apple.com
- Use the Techno Optics LLC business entity for the membership (not your personal Apple ID)
- DUNS number required for org-level enrollment (free via dnb.com)

### 2. Bundle identifier + signing

- Bundle ID: `com.taxottic.app` (already configured in `capacitor.config.ts`)
- Register the bundle ID in App Store Connect under Identifiers
- Generate an iOS Distribution Certificate + App Store provisioning profile
- Match Xcode signing to the profile

### 3. App Store Connect listing

- App name: **Taxottic**
- Subtitle: "Tax forecasting for freelancers"
- Category: Finance (primary), Business (secondary)
- Age rating: 4+
- Pricing: Free with In-App Purchase OR external-payment links (see §4 below)
- Privacy nutrition labels (App Privacy section):
  - Data Linked to You: Identifiers, Financial Info, Usage Data
  - Data Used to Track You: None
  - Privacy policy URL: `https://taxottic.com/legal/privacy`

### 4. Payment compliance (the hard part)

Apple rejects apps that take payment OUTSIDE In-App Purchase for digital goods. Taxottic's billing flow uses Stripe at 2.9% — much cheaper than Apple's 30%. Options:

**Option A — External payment links (recommended)**

Use Apple's "External Link Account Entitlement" (introduced 2024 after the Epic v. Apple ruling):

1. Apply for the entitlement at developer.apple.com
2. Add the entitlement to your provisioning profile
3. Show a one-time disclosure modal before linking out to taxottic.com/billing
4. Outbound URL must be a real browser open (`Linking.openURL`), not embedded WebView
5. Apple still takes a 27% commission on payments made within 7 days of the link click

**Option B — In-App Purchase**

Wire `@capacitor-community/in-app-purchases` or `@revenuecat/purchases-capacitor`. Configure StoreKit products in App Store Connect. Apple's 30% commission on all payments. Higher friction for users but compliant by default.

**Option C — Reader app exception**

Some categories (magazines, music, education) qualify for the reader-app exception which permits external account creation without IAP. Tax-prep doesn't currently qualify; Apple's guidance is fluid.

### 5. App Review submission

- Test build via Xcode → Product → Archive → Distribute → App Store Connect
- Provide review notes: "Taxottic is a tax-forecasting web app wrapped in Capacitor. Test account: review@taxottic.com / [generate temp password]. Most app behavior requires sign-in."
- Demo account must be functional (Apple rejects apps where they can't log in)
- Review SLA: typically 24-72 hours

### 6. Common rejection reasons

- **4.2 Minimum functionality**: Apple sometimes flags 100%-WebView apps. Mitigation: emphasize the native plugins (Camera for receipt capture, Push for tax-deadline reminders, Haptics for action confirmations)
- **5.1.1 Privacy — data collection**: ensure the privacy policy URL works + nutrition labels match actual behavior
- **3.1.1 In-App Purchase**: if using external payment, ensure the disclosure modal + outbound flow exactly match Apple's spec

## Google Play

### 1. Play Console developer account ($25 one-time)

- play.google.com/console — sign up under Techno Optics LLC
- Same DUNS not required, but tax info IS (W-9 for US-based entity)

### 2. Bundle + signing

- Bundle ID: `com.taxottic.app`
- Generate a Google Play App Signing key (Google holds the upload key — you can't lose it)
- Generate signed AAB (Android App Bundle): `cd android && ./gradlew bundleRelease`

### 3. Play Console listing

- App name: **Taxottic**
- Short description (80 chars): "Tax forecasting for freelancers + small business. Calm, accurate, IRS-cited."
- Full description (4,000 chars): pull from `/firms` page + the existing marketing copy
- Category: Finance
- Content rating: complete the IARC questionnaire (Everyone)
- Privacy policy URL: `https://taxottic.com/legal/privacy`

### 4. Data safety section (Play Console)

Same data-collection map as Apple's nutrition labels:
- Data collected: name, email, financial info, usage analytics
- Data shared with third parties: Plaid (bank), Stripe (payments), Anthropic (Bella AI)
- Encrypted in transit: yes
- Data deletion: users can request deletion via Settings → Account

### 5. Payment compliance

Google's Play Billing rules mirror Apple's but are slightly more permissive:
- Tax-prep services don't fall under Google's required IAP categories
- External payment links permitted with disclosure
- Google still takes a 15-30% fee on IAP transactions

### 6. App review submission

- Upload signed AAB via Play Console → Production track
- Review SLA: 1-3 days for new apps, ~hours for updates
- Pre-launch report runs automatically (basic device-farm test)

## Pre-submission checklist

- [ ] Apple Developer Program enrollment active
- [ ] Google Play Console developer account active
- [ ] Bundle ID `com.taxottic.app` registered on both
- [ ] iOS Distribution Certificate + provisioning profile generated
- [ ] Android Play App Signing key uploaded
- [ ] Privacy policy live at `https://taxottic.com/legal/privacy` and matches actual data collection
- [ ] App Store Connect listing fields filled (name, subtitle, category, screenshots, nutrition labels)
- [ ] Play Console listing fields filled (name, descriptions, screenshots, data safety)
- [ ] Apple External Link Account entitlement applied for (if not using IAP)
- [ ] Demo account created (`review@taxottic.com` or similar) with seeded data
- [ ] Screenshots generated for all required sizes (iPhone 6.7", iPhone 6.5", iPad 12.9", Android phone, Android tablet)

## Screenshot sizes required

**iOS:**
- iPhone 6.7" — 1290 × 2796
- iPhone 6.5" — 1242 × 2688
- iPad Pro 12.9" 3rd gen+ — 2048 × 2732

**Android:**
- Phone — 1080 × 1920 minimum
- 7" tablet — 1200 × 1920 minimum
- 10" tablet — 1920 × 1200 minimum

Use a tool like fastlane snapshot or simctl to automate.

## Post-submission

- **Crash reporting**: wire `@sentry/capacitor` or Firebase Crashlytics. Capacitor 8 supports both.
- **Analytics**: keep using PostHog / consumer analytics — Apple lets you collect usage data with proper disclosure
- **Deep links**: configured already in `capacitor.config.ts` (`captureInput: true` on Android). Test that `https://taxottic.com/c/{id}/forecast` opens the native app when installed.
- **Updates**: bump version in `capacitor.config.ts` + iOS `Info.plist` + Android `build.gradle`; re-archive + re-submit. Apple reviews every update; Google often skips.

## Why this isn't in code

Most of the above is account creation, certificate management, and human-in-the-loop review. The CODE side is done; the steps in this runbook are the operational work that has to happen in dashboards + DUNS forms + Apple's developer portal.
