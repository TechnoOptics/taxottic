// Composite raw phone captures into branded navy/gold marketing frames.
// Pure sharp (no browser). Outputs at a target store size.
//   node frame.mjs play       -> 1080x1920 (Google Play phone)
//   node frame.mjs appstore   -> 1290x2796 (App Store 6.9")
import sharp from "sharp";
import { readFile, mkdir } from "fs/promises";
import path from "path";

const mode = process.argv[2] || "play";
const TARGET = mode === "appstore"
  ? { W: 1290, H: 2796, dir: "store-screenshots/appstore", suffix: "-appstore" }
  : mode === "appstore65"
  ? { W: 1242, H: 2688, dir: "store-screenshots/appstore", suffix: "-65" }
  : { W: 1080, H: 1920, dir: "store-screenshots/play", suffix: "-play" };

const RAW = "store-screenshots/raw-emu";
const screens = [
  { file: "01-dashboard.png", kicker: "YEAR-ROUND CLARITY", headline: ["Your whole tax", "picture at a glance"] },
  { file: "02-mileage.png", kicker: "AUTOMATIC MILEAGE", headline: ["Every work drive,", "a bigger deduction"] },
  { file: "03-expenses.png", kicker: "EFFORTLESS TRACKING", headline: ["Every expense,", "month by month"] },
  { file: "04-deductions.png", kicker: "MAXIMIZE DEDUCTIONS", headline: ["See what you've", "written off"] },
  { file: "05-explore.png", kicker: "IRS-CITED DEDUCTIONS", headline: ["Hundreds of write-offs,", "sourced to the code"] },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function bgSvg(W, H, kicker, headline) {
  const k = Math.round(W / 1080); // scale factor vs the 1080-wide baseline
  const kickerSize = Math.round(30 * (W / 1080));
  const headSize = Math.round(76 * (W / 1080));
  const lineGap = Math.round(90 * (W / 1080));
  const kickerY = Math.round(160 * (H / 1920));
  const headY0 = Math.round(250 * (H / 1920));
  const lines = headline
    .map(
      (t, i) =>
        `<text x="${W / 2}" y="${headY0 + i * lineGap}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${headSize}" font-weight="700" fill="#F7F3EA">${esc(t)}</text>`,
    )
    .join("");
  const dotY = headY0 + (headline.length - 1) * lineGap + Math.round(46 * (W / 1080));
  return Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#17213b"/><stop offset="0.55" stop-color="#0f1830"/><stop offset="1" stop-color="#090f1f"/>
      </linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
      <text x="${W / 2}" y="${kickerY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${kickerSize}" letter-spacing="${6 * k}" font-weight="700" fill="#C9A14A">${esc(kicker)}</text>
      ${lines}
      <rect x="${W / 2 - 26 * k}" y="${dotY}" width="${52 * k}" height="${3 * k}" rx="${1.5 * k}" fill="#C9A14A" opacity="0.9"/>
    </svg>`,
  );
}

const maskSvg = (w, h, r) =>
  Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );

async function run() {
  await mkdir(TARGET.dir, { recursive: true });
  const { W, H } = TARGET;
  // Phone occupies the lower ~70%; leave headroom for the caption.
  const phoneTop = Math.round(H * 0.235);
  const avail = H - phoneTop - Math.round(H * 0.02);
  for (const s of screens) {
    const rawBuf = await readFile(path.join(RAW, s.file));
    const meta = await sharp(rawBuf).metadata();
    const ar = meta.height / meta.width; // ~2.222
    // Fit screenshot height into available vertical space.
    let Sh = avail;
    let Sw = Math.round(Sh / ar);
    const maxW = Math.round(W * 0.66);
    if (Sw > maxW) { Sw = maxW; Sh = Math.round(Sw * ar); }
    const radius = Math.round(Sw * 0.07);
    const shot = await sharp(rawBuf)
      .resize(Sw, Sh)
      .composite([{ input: maskSvg(Sw, Sh, radius), blend: "dest-in" }])
      .png()
      .toBuffer();
    const bez = Math.round(Sw * 0.022);
    const bezelW = Sw + bez * 2;
    const bezelH = Sh + bez * 2;
    const bezel = await sharp({
      create: { width: bezelW, height: bezelH, channels: 4, background: { r: 4, g: 7, b: 14, alpha: 1 } },
    })
      .composite([{ input: maskSvg(bezelW, bezelH, radius + bez), blend: "dest-in" }])
      .png()
      .toBuffer();
    const bezelX = Math.round((W - bezelW) / 2);
    const out = await sharp(bgSvg(W, H, s.kicker, s.headline))
      .composite([
        { input: bezel, left: bezelX, top: phoneTop - bez },
        { input: shot, left: bezelX + bez, top: phoneTop },
      ])
      .png()
      .toBuffer();
    const outName = s.file.replace(".png", TARGET.suffix + ".png");
    await sharp(out).png().toFile(path.join(TARGET.dir, outName));
    console.log("wrote", path.join(TARGET.dir, outName), `${W}x${H}`);
  }
}
run();
