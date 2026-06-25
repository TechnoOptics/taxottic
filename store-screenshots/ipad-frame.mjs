// Size raw iPad-layout captures (1536x2048 tablet render from the emulator)
// to the App Store Connect 13" iPad display slot: 2048x2732 portrait.
// Full-bleed — the app's tablet layout fills the frame (no phone bezel).
//   node store-screenshots/ipad-frame.mjs
import sharp from "sharp";
import { readFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw-ipad");
const OUT = path.join(HERE, "ipad");
const W = 2048;
const H = 2732;

// Story order, parallel to the iPhone set.
const screens = [
  "ipad-dash.png",
  "ipad-mileage.png",
  "ipad-expenses.png",
  "ipad-deductions.png",
  "ipad-explore.png",
];

async function run() {
  await mkdir(OUT, { recursive: true });
  for (const f of screens) {
    const buf = await readFile(path.join(RAW, f));
    // 1536x2048 (0.750) -> 2048x2732 (0.7497): a <0.05% vertical scale, imperceptible.
    await sharp(buf).resize(W, H, { fit: "fill" }).png().toFile(path.join(OUT, f));
    console.log("wrote", path.join(OUT, f), `${W}x${H}`);
  }
}
run();
