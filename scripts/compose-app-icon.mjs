#!/usr/bin/env node
/**
 * Compose the master app-icon tile from the brand growth-chart logo
 * centered on Taxottic's forest-green background.
 *
 * Input:  the user's white-version Icon.png (logo on transparent
 *         canvas, positioned bottom-right at ~50-60% size)
 * Output: assets/icon.png       1024×1024 logo centered on forest
 *         assets/icon-foreground.png  same (Android adaptive icon)
 *         assets/splash.png     2732×2732 logo centered on forest
 *         assets/splash-dark.png same
 *
 * Why we need to compose: capacitor-assets just resizes whatever you
 * give it. If we hand it the raw logo with its bottom-right
 * positioning + transparent canvas, the iOS tile would show a tiny
 * gold mark in the corner of a black square. We pre-compose the
 * visually correct layout once.
 */

import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const SRC =
  "C:/Users/abelm/OneDrive - technooptics.org/Group Of Compannies/Taxottic/Logo/White Version/Icon.png";

const FOREST = "#0a1f19"; // Taxottic dark brand color

async function compose({ size, outPath, logoPctOfCanvas }) {
  // 1. Trim transparent edges from the logo so we can re-center it.
  const trimmed = await sharp(SRC).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();

  // 2. Resize the trimmed logo to ~logoPctOfCanvas of the target.
  const targetLogoSize = Math.round(size * logoPctOfCanvas);
  const aspectRatio = (meta.width ?? 1) / (meta.height ?? 1);
  const logoWidth =
    aspectRatio >= 1 ? targetLogoSize : Math.round(targetLogoSize * aspectRatio);
  const logoHeight =
    aspectRatio >= 1 ? Math.round(targetLogoSize / aspectRatio) : targetLogoSize;

  const resizedLogo = await sharp(trimmed)
    .resize(logoWidth, logoHeight, { fit: "inside" })
    .png()
    .toBuffer();

  // 3. Composite onto a forest-green canvas, centered.
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: FOREST,
    },
  })
    .composite([
      {
        input: resizedLogo,
        gravity: "center",
      },
    ])
    .png()
    .toFile(outPath);

  console.log(`✓ ${outPath} (${size}×${size}, logo ${logoWidth}×${logoHeight})`);
}

await mkdir("assets", { recursive: true });

// App icon: logo at 65% of canvas — gives strong presence at home-screen
// size without crowding the corners (where iOS/Android round-mask).
await compose({
  size: 1024,
  outPath: "assets/icon.png",
  logoPctOfCanvas: 0.65,
});
await compose({
  size: 1024,
  outPath: "assets/icon-foreground.png",
  logoPctOfCanvas: 0.5, // adaptive icons get cropped — leave more padding
});

// Splash: logo at 30% of canvas — splash screens prefer a smaller mark
// since the screen is huge and the logo should breathe.
await compose({
  size: 2732,
  outPath: "assets/splash.png",
  logoPctOfCanvas: 0.3,
});
await compose({
  size: 2732,
  outPath: "assets/splash-dark.png",
  logoPctOfCanvas: 0.3,
});

console.log("\nDone. Run: npx capacitor-assets generate");
