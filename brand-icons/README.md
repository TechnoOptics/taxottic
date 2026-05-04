# Taxottic brand icon bundle

Single source of truth for the Taxottic icon + header wordmark, exported
to every format the web app and an iOS App Store submission need. Built
from two source files (the **White Version** of the brand mark):

- `source/Icon.png`       — 1024 × 1024 white icon glyph
- `source/Main Logo.png`  — 14571 × 1762 horizontal white wordmark (icon + "Taxottic")

## Folder layout

```
brand-icons/
├── source/
│   ├── Icon.png                       master icon glyph
│   └── Main Logo.png                  master horizontal wordmark
├── scripts/
│   └── generate.mjs                   regenerates web/ + ios/ from source
├── web/                               drop into the Next.js repo
│   ├── app/
│   │   ├── favicon.ico                multi-size ICO (16/32/48), forest tile
│   │   ├── icon.png                   512 × 512 forest tile
│   │   └── apple-icon.png             180 × 180 forest tile
│   └── public/
│       ├── icon-192.png               192 × 192 (PWA manifest, opaque)
│       ├── icon-512.png               512 × 512 (PWA manifest, opaque)
│       └── brand/
│           ├── favicon-32.png         32 × 32  (mirror copy)
│           ├── favicon-512.png        512 × 512 (mirror copy)
│           ├── apple-touch-icon.png   180 × 180 (mirror copy)
│           └── wordmark-white.png     2117 × 256 horizontal lockup, transparent
└── ios/
    └── AppIcon.appiconset/            drag straight into Assets.xcassets
        ├── Contents.json
        ├── icon-20.png … icon-83.5@2x.png   all required iPhone + iPad sizes
        └── icon-1024.png              App Store marketing (no alpha)
```

## Why the icons are flattened on forest green

The source icon is **white** on transparent. On a light browser tab a raw
white-on-transparent favicon is invisible. Every favicon, PWA icon, and
iOS app icon in this bundle is composited onto the brand forest tile
(`#0f2d24`, the AppHeader gradient floor + manifest theme color) with a
14% inset around the glyph. That gives a brand-coloured square that
renders cleanly on every tab background, every iOS home screen, and
satisfies App Store Connect's no-alpha requirement on the 1024
marketing icon.

The header wordmark (`wordmark-white.png`) stays transparent because it
sits on the dark forest header — compositing happens in CSS.

## Sequence on the MacBook

### 1. Get the bundle onto the Mac
Zip `brand-icons/` and move it via OneDrive / iCloud / AirDrop / git.

### 2. Apply the web assets (Next.js)
From the Taxottic repo root:

```bash
cp brand-icons/web/app/favicon.ico              app/favicon.ico
cp brand-icons/web/app/icon.png                 app/icon.png
cp brand-icons/web/app/apple-icon.png           app/apple-icon.png
cp brand-icons/web/public/icon-192.png          public/icon-192.png
cp brand-icons/web/public/icon-512.png          public/icon-512.png
cp brand-icons/web/public/brand/favicon-32.png  public/brand/favicon-32.png
cp brand-icons/web/public/brand/favicon-512.png public/brand/favicon-512.png
cp brand-icons/web/public/brand/apple-touch-icon.png public/brand/apple-touch-icon.png
cp brand-icons/web/public/brand/wordmark-white.png   public/brand/wordmark-white.png
```

(The Windows worktree this bundle was built in already has these copied —
this step is for a fresh clone on the Mac.)

`components/Wordmark.tsx` reads `/brand/wordmark-white.png` when
`tone="cream"` (currently only the AppHeader passes that). The default
`tone="forest"` on cream pages still uses the existing icon + live text
composition.

Verify in a browser: hard-reload `http://localhost:3000`, the green
favicon tile with the white mark should appear in the tab. Sign in and
check the AppHeader — the white horizontal wordmark should sit on the
forest gradient. To force-refresh past a cached favicon, open in a
private window or visit `/favicon.ico?v=2`.

### 3. Add the icon to the iOS Xcode project

Inside the iOS project (the Capacitor / wrapper / native shell):

1. Open the project in Xcode.
2. In the Project Navigator, select `Assets.xcassets`.
3. Right-click the existing `AppIcon` set → **Remove**.
4. Drag `brand-icons/ios/AppIcon.appiconset` from Finder into
   `Assets.xcassets`. Confirm "Copy items if needed" is checked.
5. Open the app target → **General** → **App Icons and Launch Images**
   and confirm **App Icon Source** is set to `AppIcon`.
6. Build and run on a simulator. Check the Home Screen, Settings, and
   Spotlight thumbnails.

The 1024 × 1024 marketing icon is included in the appiconset and ships
automatically with the archive — no separate upload to App Store Connect.

### 4. Submit to App Store Connect

Once the build is archived in Xcode (`Product → Archive`):

1. Open Window → Organizer → select the new archive.
2. Click **Distribute App** → **App Store Connect** → **Upload**.
3. In App Store Connect, the icon will be picked up from the IPA. No
   separate upload needed.

## Regenerating from a new source

If the brand mark changes, replace one or both source files and rerun:

```bash
cd brand-icons
npm install --no-save sharp     # one-time on a fresh machine
node scripts/generate.mjs
```

Every variant in `web/` and `ios/` is rebuilt deterministically.

## Pre-existing notes worth flagging

- `public/icon.svg` in the live repo is still the old "T on dark green"
  placeholder. It's referenced by `app/layout.tsx` and the PWA manifest.
  Browsers that prefer SVG will use it before falling back to the PNGs.
  Either delete the SVG entry from `manifest.webmanifest` and
  `app/layout.tsx`, or replace the SVG with a re-traced version of the
  new mark.
- The PWA manifest already lists `/icon-192.png` and `/icon-512.png`,
  which is why this bundle generates them — drop them in `public/` and
  the PWA install will stop 404-ing.
