# Mac setup — migrating Taxottic from Windows

This is a git-based project, so "migrating" to a Mac means **clone fresh + restore
the handful of things git intentionally doesn't track**. Nothing is copied wholesale
from the Windows box — that avoids stale `node_modules`, line-ending churn, and
machine-specific paths.

Repo: `https://github.com/TechnoOptics/taxottic` · package manager: **npm** · Node **≥20.10** (pinned in `.nvmrc`).

---

## What clone brings vs. what you must restore

| | Comes with `git clone`? | How to restore on the Mac |
|---|---|---|
| App source, `ios/` + `android/` native projects, `capacitor.config.ts`, `package-lock.json` | ✅ yes | — |
| `node_modules`, `.next/` | ❌ | `npm ci` |
| iOS Swift Package dependencies (Capacitor SPM) | ❌ | resolved automatically by Xcode on open; `npx cap sync ios` regenerates `ios/App/CapApp-SPM/Package.swift` |
| `android/local.properties` | ❌ | auto-created by Android Studio (do **not** copy the Windows one) |
| `.env.local` (dev secrets) | ❌ | `vercel env pull` (preferred) — see below |
| `.vercel` (project link) | ❌ | `vercel link` |
| FCM/APNs push creds (`google-services.json`, `GoogleService-Info.plist`, `AuthKey_*.p8`) | ❌ | see `docs/PUSH_NOTIFICATIONS_SETUP.md` — only needed for push-enabled native builds |
| Android keystore / iOS signing | ❌ | Xcode-managed / in CI — nothing was stored on the Windows machine |

> The only must-keep secret that lived on the Windows machine was `.env.local`, and
> even that is regenerated from Vercel below — so there's nothing irreplaceable to
> hand-carry.

---

## 1. Toolchain

```bash
# Homebrew (if not installed): https://brew.sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install git cocoapods watchman
# Xcode: install from the App Store, then:
xcode-select --install            # command-line tools
sudo xcodebuild -license accept   # accept the SDK license

# Node via nvm, matched to .nvmrc
brew install nvm   # then follow brew's note to add nvm to your shell profile
```

## 2. Clone + dependencies

```bash
git clone https://github.com/TechnoOptics/taxottic.git
cd taxottic
nvm install && nvm use   # reads .nvmrc
npm ci
```

## 3. Restore env (`.env.local`) from Vercel

```bash
npm i -g vercel
vercel login
vercel link            # pick the TechnoOptics / taxottic project
vercel env pull .env.local   # pulls the Development env vars
```

Then sanity-check against the template — anything in `.env.local.example` that's
missing from the pulled file is a dev-only key to add by hand:

```bash
diff <(grep -o '^[A-Z_]*' .env.local.example | sort -u) \
     <(grep -o '^[A-Z_]*' .env.local | sort -u)
```

## 4. Run the web app

```bash
npm run dev        # http://localhost:3000
npm run lint && npm run typecheck   # confirm a clean checkout
```

## 5. iOS (the reason for the move)

```bash
npx cap sync ios
open ios/App/App.xcodeproj   # SPM-based — no pod install, no .xcworkspace
```
This project uses Capacitor 8's Swift Package Manager integration: there is **no
Podfile and no `.xcworkspace`**. `npx cap sync ios` regenerates
`ios/App/CapApp-SPM/Package.swift`, and Xcode resolves the SPM packages
automatically when you open `App.xcodeproj` (`pod install` would just fail with
"No Podfile found"). CocoaPods can stay installed — it's simply unused here.

In Xcode: pick a **Simulator** and press ▶ — a Simulator build needs no signing
Team. (You only need to select a Team under **Signing & Capabilities** for a
device or App Store build.) The app is a WebView pinned to `taxottic.com`
(`server.url` in `capacitor.config.ts`), so it loads production.

**Native screenshots** (this is what unblocks the App Store rejection going forward):
run in the Simulator, then `⌘S` (File ▸ Save Screen), or
`xcrun simctl io booted screenshot out.png`. The iOS status bar is genuine, so no
chrome-stripping is needed — unlike the Android-emulator captures that triggered
Guideline 2.3.10.

## 6. Android (optional, parity with the old machine)

```bash
npx cap sync android
open -a "Android Studio" android   # let it create local.properties + sync Gradle
```

## 7. Re-auth the CLIs

```bash
gh auth login                              # GitHub
brew install supabase/tap/supabase && supabase login
# vercel was logged in during step 3
```

> Supabase migrations are applied manually after merge (CI's db-migrate step is a
> no-op without `SUPABASE_ACCESS_TOKEN`) — keep doing that as before.

---

## Notes / gotchas

- **Don't copy `node_modules`, `.next`, or `android/local.properties`** from Windows — they're platform-specific. Regenerate them with the steps above. (iOS has no `Pods/` to copy — SPM dependencies are resolved by Xcode into DerivedData.)
- The `.claude/` folder (and its worktrees) is gitignored and stays on the old machine — expected.
- `store-screenshots/` holds the marketing-frame scripts; image assets there are gitignored and regenerated. See `store-screenshots/README.md`.
- After verifying the Mac builds and runs, the Windows checkout can be archived.
