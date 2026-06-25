#!/usr/bin/env node
/**
 * Regenerate every icon asset across the codebase from a single
 * source PNG. Run with:
 *
 *   node scripts/brand/generate-icons.mjs
 *
 * Writes to:
 *   app/favicon.ico                                  web favicon
 *   app/icon.png                                     web 512px icon
 *   app/apple-icon.png                               iOS Safari add-to-home
 *   android/app/src/main/res/mipmap-{6 densities}/   Capacitor phone app
 *     ic_launcher.png            full square, navy gradient + icon
 *     ic_launcher_round.png      same (Android applies the round mask)
 *     ic_launcher_background.png solid gradient (adaptive icon bg)
 *     ic_launcher_foreground.png transparent + icon (adaptive icon fg)
 *   wear/src/main/res/mipmap-{xhdpi,xxhdpi}/         Wear OS app
 *     ic_launcher.png            full square
 *     ic_launcher_round.png      same
 *   ios/App/App/Assets.xcassets/AppIcon.appiconset/  Capacitor iOS
 *     AppIcon-512@2x.png         1024×1024 with navy gradient
 *
 * Source: assets/brand/icon-source.png (transparent-bg chart-with-arrow
 * mark, 500×500 RGBA — but any size works, we resize).
 *
 * Background for tile variants: the same 3-stop navy gradient used
 * everywhere else in the brand surfaces:
 *   #2a3a5e → #1d2843 (60%) → #121a2a
 * (see app/watch/link/page.tsx and most of the dark-mode pages).
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SOURCE = resolve(REPO_ROOT, "assets/brand/icon-source.png");

/** Premium navy gradient — top to bottom. */
function paintGradient(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#2a3a5e");
  g.addColorStop(0.6, "#1d2843");
  g.addColorStop(1, "#121a2a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Tile = navy gradient + icon centered with margin. iconScale is the
 * fraction of the canvas the icon should occupy (default 0.62 leaves
 * about 19% margin on each side — looks balanced at every density and
 * survives Android's round-launcher mask).
 */
async function makeTile(srcImage, size, iconScale = 0.62) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  paintGradient(ctx, size, size);
  const iconSize = Math.round(size * iconScale);
  const offset = Math.round((size - iconSize) / 2);
  ctx.drawImage(srcImage, offset, offset, iconSize, iconSize);
  return canvas.toBuffer("image/png");
}

/** Transparent variant — just the icon, resized. */
async function makeTransparent(srcImage, size, iconScale = 1) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const iconSize = Math.round(size * iconScale);
  const offset = Math.round((size - iconSize) / 2);
  ctx.drawImage(srcImage, offset, offset, iconSize, iconSize);
  return canvas.toBuffer("image/png");
}

/** Solid-gradient background — no icon. Used for adaptive-icon bg. */
async function makeGradientOnly(size) {
  const canvas = createCanvas(size, size);
  paintGradient(canvas.getContext("2d"), size, size);
  return canvas.toBuffer("image/png");
}

async function write(relPath, buf) {
  const full = resolve(REPO_ROOT, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, buf);
   
  console.log("  wrote", relPath, `(${(buf.length / 1024).toFixed(1)} KB)`);
}

// Android density buckets in px for a 48dp launcher icon
// (mdpi=1x baseline, scaled by each density factor).
const LAUNCHER_DENSITIES = {
  ldpi: 36,
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};
// Adaptive icon foreground/background — 108dp at each density.
const ADAPTIVE_DENSITIES = {
  ldpi: 81,
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};

async function main() {
  console.log("Loading source:", SOURCE);
  const src = await loadImage(SOURCE);

  // ── Web ───────────────────────────────────────────────────
  console.log("\n[web]");
  await write("app/icon.png", await makeTransparent(src, 512));
  // favicon.ico — most browsers accept a PNG with .ico extension
  // (the file format check is on the bytes, not the extension).
  // Use a small 32×32 PNG; legacy IE-only browsers would want a true
  // multi-resolution ICO but the audit shipped this same way.
  await write("app/favicon.ico", await makeTransparent(src, 32));
  await write("app/apple-icon.png", await makeTile(src, 180));

  // ── Capacitor Android phone app ─────────────────────────
  console.log("\n[android/Capacitor]");
  for (const [density, px] of Object.entries(LAUNCHER_DENSITIES)) {
    const square = await makeTile(src, px);
    await write(`android/app/src/main/res/mipmap-${density}/ic_launcher.png`, square);
    await write(
      `android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`,
      square,
    );
  }
  for (const [density, px] of Object.entries(ADAPTIVE_DENSITIES)) {
    await write(
      `android/app/src/main/res/mipmap-${density}/ic_launcher_background.png`,
      await makeGradientOnly(px),
    );
    // Adaptive foreground: transparent + icon. The system insets the
    // foreground by 16.7% per mipmap-anydpi-v26/ic_launcher.xml, so
    // we want the icon to occupy ~80% of the 108dp canvas (matches
    // the launcher-icon look across home-screen styles).
    await write(
      `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`,
      await makeTransparent(src, px, 0.8),
    );
  }

  // ── Wear OS ─────────────────────────────────────────────
  // Wear's typical density buckets are xhdpi (96) and xxhdpi (144);
  // the manifest in this repo points at a single @drawable/ic_launcher
  // (vector) — we rewire it to @mipmap/ic_launcher (PNG) so we get
  // the same gradient tile as the phone app.
  console.log("\n[wear]");
  for (const density of ["xhdpi", "xxhdpi"]) {
    const px = LAUNCHER_DENSITIES[density];
    const tile = await makeTile(src, px);
    await write(`wear/src/main/res/mipmap-${density}/ic_launcher.png`, tile);
    await write(
      `wear/src/main/res/mipmap-${density}/ic_launcher_round.png`,
      tile,
    );
  }

  // ── iOS (Capacitor) ─────────────────────────────────────
  // Modern Xcode App Icon = single 1024×1024 PNG. Cannot have
  // transparency on iOS app icons (Apple rejects upload). Use the
  // tile variant with the gradient baked in.
  console.log("\n[ios]");
  await write(
    "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
    await makeTile(src, 1024),
  );

  // ── public/brand/* — referenced by the loading screen, PWA
  //    manifest, marketing/share images. The loading screen pulls
  //    /brand/icon-mark-cream.svg (still SVG-shaped); we replace
  //    that SVG with a wrapper that embeds the new mark as a
  //    base64 PNG so every surface picks up the refresh
  //    automatically without code edits on the consuming pages.
  console.log("\n[public/brand]");
  const transparent1024 = await makeTransparent(src, 1024);
  const transparent512 = await makeTransparent(src, 512);
  const transparent120 = await makeTransparent(src, 120);
  await write("public/brand/icon-mark-1024.png", transparent1024);
  await write("public/brand/icon-mark-512.png", transparent512);
  await write("public/brand/icon-mark-120.png", transparent120);
  // "cream" variant historically was the same mark tinted cream
  // for the dark-bg loading screen; the new mark is already gold/
  // amber on transparent (the same colours that read well on
  // navy), so re-use the same PNG.
  await write("public/brand/icon-mark-cream-1024.png", transparent1024);
  // SVG wrapper that the loading screen requests by URL. Embed the
  // PNG as a data: URI so a single asset carries the bitmap.
  const svgWrap = (b64) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<image href="data:image/png;base64,${b64}" width="512" height="512"/>` +
    `</svg>`;
  await write(
    "public/brand/icon-mark.svg",
    Buffer.from(svgWrap(transparent512.toString("base64")), "utf8"),
  );
  await write(
    "public/brand/icon-mark-cream.svg",
    Buffer.from(svgWrap(transparent512.toString("base64")), "utf8"),
  );
  // Misc public/brand entries the existing layout/meta pulls in.
  await write(
    "public/brand/favicon-512.png",
    await makeTransparent(src, 512),
  );
  await write(
    "public/brand/favicon-32.png",
    await makeTransparent(src, 32),
  );
  await write(
    "public/brand/favicon.png",
    await makeTransparent(src, 512),
  );
  await write(
    "public/brand/apple-touch-icon.png",
    await makeTile(src, 180),
  );

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
