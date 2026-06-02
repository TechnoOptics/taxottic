import sharp from "sharp";
const SRC = "assets/brand/icon-source.png";
const RES = "android/app/src/main/res";
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
// Build a centered white silhouette of the full T+chart mark.
const meta = await sharp(SRC).metadata();
const alpha = await sharp(SRC).ensureAlpha().extractChannel(3).linear(3, -150).toColourspace("b-w").toBuffer();
const sil = await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: { r: 255, g: 255, b: 255 } } }).joinChannel(alpha).png().toBuffer();
const trimmed = await sharp(sil).trim({ threshold: 20 }).toBuffer();
const tm = await sharp(trimmed).metadata();
const side = Math.max(tm.width, tm.height);
const pad = Math.round(side * 0.08);
const box = side + pad * 2;
const master = await sharp({ create: { width: box, height: box, channels: 4, background: CLEAR } }).composite([{ input: trimmed, gravity: "center" }]).png().toBuffer();
// Notification small icon: 24dp baseline.
const DENS = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };
for (const [d, px] of Object.entries(DENS)) {
  await sharp(master).resize(px, px).png().toFile(`${RES}/drawable-${d}/ic_stat_taxottic.png`);
  console.log(`drawable-${d}/ic_stat_taxottic.png ${px}px`);
}
