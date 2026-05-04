// Regenerate every Taxottic icon variant from a single source.
//
// Inputs:  ../source/Icon.png       (master icon — currently White Version)
//          ../source/Main Logo.png  (full horizontal wordmark — White Version)
// Outputs: ../web/...               (Next.js favicon + PWA assets + wordmark)
//          ../ios/AppIcon.appiconset/...  (Xcode asset catalog)
//
// Usage on macOS / Windows / Linux:
//   cd brand-icons
//   npm install --no-save sharp
//   node scripts/generate.mjs

import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const ICON_SRC = join(root, "source", "Icon.png");
const WORDMARK_SRC = join(root, "source", "Main Logo.png");

// Forest green — the AppHeader gradient floor and the manifest theme color.
// The current source is the white version of the mark, so a transparent
// tile would be invisible on light browser tabs. Flattening on forest gives
// every favicon / iOS icon a brand-coloured square that renders everywhere.
const FOREST = { r: 0x0f, g: 0x2d, b: 0x24, alpha: 1 };

async function iconTransparent(size) {
  return sharp(ICON_SRC)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function iconForestTile(size) {
  // Padded inset so the white mark doesn't crowd the edge of the green tile.
  // Apple icon-grid practice gives the glyph ~80% of the canvas at small
  // sizes, more breathing room at large sizes. We use a flat 14% inset on
  // every side, which reads well from 16 px favicons up to the 1024
  // marketing icon.
  const inset = Math.round(size * 0.14);
  const inner = size - inset * 2;
  const glyph = await sharp(ICON_SRC)
    .resize(inner, inner, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: FOREST,
    },
  })
    .composite([{ input: glyph, top: inset, left: inset }])
    .flatten({ background: FOREST })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function wordmarkWhite(height) {
  // Keep transparent — the wordmark is rendered on the dark forest header,
  // which composites the white mark cleanly. Width auto-scales from height.
  return sharp(WORDMARK_SRC)
    .resize({
      height,
      withoutEnlargement: false,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function buildIco(sizes) {
  // ICO entries inherit the same forest tile so the legacy favicon.ico
  // matches the modern PNG variants in any browser that falls back to it.
  const pngs = await Promise.all(sizes.map(iconForestTile));
  const HEADER = 6;
  const ENTRY = 16;
  const dirSize = HEADER + ENTRY * sizes.length;

  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const entries = [];
  let offset = dirSize;
  for (let i = 0; i < sizes.length; i++) {
    const e = Buffer.alloc(ENTRY);
    const s = sizes[i];
    e.writeUInt8(s === 256 ? 0 : s, 0);
    e.writeUInt8(s === 256 ? 0 : s, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += pngs[i].length;
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

async function writeAsset(path, buf) {
  writeFileSync(path, buf);
  const rel = path.replace(root + "\\", "").replace(root + "/", "");
  console.log(" •", rel, buf.length, "bytes");
}

async function main() {
  console.log("Icon source:    ", ICON_SRC);
  console.log("Wordmark source:", WORDMARK_SRC);

  // ─── Web (Next.js + PWA) ───────────────────────────────────────────────
  const webApp = join(root, "web", "app");
  const webPublic = join(root, "web", "public");
  const webBrand = join(webPublic, "brand");

  const ico = await buildIco([16, 32, 48]);
  await writeAsset(join(webApp, "favicon.ico"), ico);
  await writeAsset(join(webApp, "icon.png"), await iconForestTile(512));
  await writeAsset(join(webApp, "apple-icon.png"), await iconForestTile(180));

  await writeAsset(join(webBrand, "favicon-32.png"), await iconForestTile(32));
  await writeAsset(join(webBrand, "favicon-512.png"), await iconForestTile(512));
  await writeAsset(join(webBrand, "apple-touch-icon.png"), await iconForestTile(180));

  // PWA manifest references these — currently missing from the live repo.
  await writeAsset(join(webPublic, "icon-192.png"), await iconForestTile(192));
  await writeAsset(join(webPublic, "icon-512.png"), await iconForestTile(512));

  // Header wordmark: 256 px tall covers every Wordmark size ("sm" 28 →
  // "lg" 42) at retina density and still compresses small.
  await writeAsset(join(webBrand, "wordmark-white.png"), await wordmarkWhite(256));

  // ─── iOS (Xcode AppIcon.appiconset) ────────────────────────────────────
  const appicon = join(root, "ios", "AppIcon.appiconset");
  const ios = [
    ["icon-20.png", 20],
    ["icon-20@2x.png", 40],
    ["icon-20@3x.png", 60],
    ["icon-29.png", 29],
    ["icon-29@2x.png", 58],
    ["icon-29@3x.png", 87],
    ["icon-40.png", 40],
    ["icon-40@2x.png", 80],
    ["icon-40@3x.png", 120],
    ["icon-60@2x.png", 120],
    ["icon-60@3x.png", 180],
    ["icon-76.png", 76],
    ["icon-76@2x.png", 152],
    ["icon-83.5@2x.png", 167],
    ["icon-1024.png", 1024], // App Store marketing — must be opaque
  ];
  for (const [name, size] of ios) {
    await writeAsset(join(appicon, name), await iconForestTile(size));
  }

  const contents = {
    images: [
      { size: "20x20", idiom: "iphone", filename: "icon-20@2x.png", scale: "2x" },
      { size: "20x20", idiom: "iphone", filename: "icon-20@3x.png", scale: "3x" },
      { size: "29x29", idiom: "iphone", filename: "icon-29@2x.png", scale: "2x" },
      { size: "29x29", idiom: "iphone", filename: "icon-29@3x.png", scale: "3x" },
      { size: "40x40", idiom: "iphone", filename: "icon-40@2x.png", scale: "2x" },
      { size: "40x40", idiom: "iphone", filename: "icon-40@3x.png", scale: "3x" },
      { size: "60x60", idiom: "iphone", filename: "icon-60@2x.png", scale: "2x" },
      { size: "60x60", idiom: "iphone", filename: "icon-60@3x.png", scale: "3x" },
      { size: "20x20", idiom: "ipad", filename: "icon-20.png", scale: "1x" },
      { size: "20x20", idiom: "ipad", filename: "icon-20@2x.png", scale: "2x" },
      { size: "29x29", idiom: "ipad", filename: "icon-29.png", scale: "1x" },
      { size: "29x29", idiom: "ipad", filename: "icon-29@2x.png", scale: "2x" },
      { size: "40x40", idiom: "ipad", filename: "icon-40.png", scale: "1x" },
      { size: "40x40", idiom: "ipad", filename: "icon-40@2x.png", scale: "2x" },
      { size: "76x76", idiom: "ipad", filename: "icon-76.png", scale: "1x" },
      { size: "76x76", idiom: "ipad", filename: "icon-76@2x.png", scale: "2x" },
      { size: "83.5x83.5", idiom: "ipad", filename: "icon-83.5@2x.png", scale: "2x" },
      { size: "1024x1024", idiom: "ios-marketing", filename: "icon-1024.png", scale: "1x" },
    ],
    info: { version: 1, author: "xcode" },
  };
  writeFileSync(join(appicon, "Contents.json"), JSON.stringify(contents, null, 2) + "\n");
  console.log(" • ios/AppIcon.appiconset/Contents.json");

  // Keep an unused helper signature around for future variants:
  void iconTransparent;

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
