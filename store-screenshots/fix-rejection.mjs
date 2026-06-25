// Remove Android system chrome (status bar clock/icons + gesture pill) from the
// store screenshots so they pass App Review Guideline 2.3.10 (Accurate Metadata).
//   iPhone: crop raw to the app header (top) + above the pill (bottom), then re-frame.
//   iPad:   paint the app's own flat colors over the status bar + pill, then resize.
import sharp from "sharp";
import { readFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = HERE;
const ROOT = HERE;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function bgSvg(W, H, kicker, headline) {
  const k = Math.round(W / 1080);
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

// Build one framed marketing screenshot from an already-cleaned raw buffer.
async function frame(rawBuf, kicker, headline, W, H) {
  const phoneTop = Math.round(H * 0.235);
  const avail = H - phoneTop - Math.round(H * 0.02);
  const meta = await sharp(rawBuf).metadata();
  const ar = meta.height / meta.width;
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
  return sharp(bgSvg(W, H, kicker, headline))
    .composite([
      { input: bezel, left: bezelX, top: phoneTop - bez },
      { input: shot, left: bezelX + bez, top: phoneTop },
    ])
    .png()
    .toBuffer();
}

const PHONE = [
  { file: "01-dashboard", kicker: "YEAR-ROUND CLARITY", headline: ["Your whole tax", "picture at a glance"] },
  { file: "02-mileage", kicker: "AUTOMATIC MILEAGE", headline: ["Every work drive,", "a bigger deduction"] },
  { file: "03-expenses", kicker: "EFFORTLESS TRACKING", headline: ["Every expense,", "month by month"] },
  { file: "04-deductions", kicker: "MAXIMIZE DEDUCTIONS", headline: ["See what you've", "written off"] },
  { file: "05-explore", kicker: "IRS-CITED DEDUCTIONS", headline: ["Hundreds of write-offs,", "sourced to the code"] },
];
// 1080x2400 raw: keep y=280..2356 (header down to just above the gesture pill).
const PH_CROP = { left: 0, top: 280, width: 1080, height: 2076 };

const IPAD = ["ipad-dash", "ipad-mileage", "ipad-expenses", "ipad-deductions", "ipad-explore"];

async function run() {
  await mkdir(`${ROOT}/appstore`, { recursive: true });
  await mkdir(`${ROOT}/ipad`, { recursive: true });

  // ---- iPhone ----
  for (const s of PHONE) {
    const raw = await readFile(`${SRC}/raw-emu/${s.file}.png`);
    const cleaned = await sharp(raw).extract(PH_CROP).png().toBuffer();
    const a = await frame(cleaned, s.kicker, s.headline, 1290, 2796);
    await sharp(a).toFile(`${ROOT}/appstore/${s.file}-appstore.png`);
    const b = await frame(cleaned, s.kicker, s.headline, 1242, 2688);
    await sharp(b).toFile(`${ROOT}/appstore/${s.file}-65.png`);
    console.log("iPhone", s.file, "-> -appstore (1290x2796) + -65 (1242x2688)");
  }

  // ---- iPad ----
  // Paint the app's own flat colors over the Android status bar (navy #2a3a5e,
  // y=0..112) and the gesture pill (#121a2a band, y=2020..2048). Done as its OWN
  // sharp pass on the 1536x2048 raw, because sharp applies composite AFTER resize
  // within a single pipeline — so paint first, then resize in a separate call.
  const overlay = Buffer.from(
    `<svg width="1536" height="2048" xmlns="http://www.w3.org/2000/svg">
       <rect x="0" y="0" width="1536" height="113" fill="#2a3a5e"/>
       <rect x="0" y="2020" width="1536" height="28" fill="#121a2a"/>
     </svg>`,
  );
  for (const f of IPAD) {
    const raw = await readFile(`${SRC}/raw-ipad/${f}.png`);
    const painted = await sharp(raw).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
    await sharp(painted).resize(2048, 2732, { fit: "fill" }).png().toFile(`${ROOT}/ipad/${f}.png`);
    console.log("iPad", f, "-> 2048x2732 (chrome painted out)");
  }
  console.log("DONE");
}
run();
