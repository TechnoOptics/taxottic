# store-screenshots

Standalone Node scripts (pure [`sharp`](https://sharp.pixelplumbing.com/), no
browser) that turn raw app captures into branded App Store / Google Play
marketing screenshots. They are **build-time tooling, not part of the app** —
they're excluded from the Next.js lint/build (see `eslint.config.mjs`).

Only the scripts are tracked; all image assets are gitignored and regenerated.

## Scripts

| Script | What it does |
|---|---|
| `frame.mjs` | Composites raw phone captures into navy/gold marketing frames. `node frame.mjs play\|appstore\|appstore65` → 1080×1920 / 1290×2796 / 1242×2688. Reads `raw-emu/`. |
| `ipad-frame.mjs` | Sizes raw iPad-layout captures to the App Store 13″ iPad slot (2048×2732), full-bleed. |
| `fix-rejection.mjs` | Removes Android system chrome (status-bar clock/icons + gesture pill) from captures — the fix for App Review Guideline 2.3.10 (Accurate Metadata). iPhone: crop to header; iPad: paint the app's own flat colors over the chrome. |
| `ios-statusbar.mjs` | Exports `iosStatusBar(W, H)` → an SVG iOS status bar (9:41 + cellular/Wi-Fi/battery) for compositing onto screenshots. |
| `make-ios-shots.mjs` | Builds the App Store set with an authentic iOS status bar composited on (uses `ios-statusbar.mjs` + the framing logic). |

> ⚠️ These were authored on the original Windows machine and contain **hardcoded
> absolute paths** (`SRC` / `ROOT` near the top of each script). Update those for
> the local checkout before running. Going forward, native screenshots are best
> captured straight from the **iOS Simulator** (Xcode) and **Android Emulator**,
> which is the canonical path once on macOS.

## Capturing raws (reference)

- **iOS:** run the app in the Simulator (Xcode), `File ▸ Save Screen` (⌘S), or
  `xcrun simctl io booted screenshot out.png`. The iOS status bar is genuine, so
  no chrome-stripping is needed.
- **Android:** `adb exec-out screencap -p > out.png`.
