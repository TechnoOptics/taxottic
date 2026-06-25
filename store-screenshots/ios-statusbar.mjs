import sharp from "sharp";
const ROOT = "C:/Users/abelm/Documents/Techno Optics LLc/taxottic/store-screenshots";

// Returns an SVG string (no outer bg) for an iOS-style status bar strip W x H.
// time left, then cellular + wifi + battery on the right. White glyphs.
export function iosStatusBar(W, H) {
  const cx = W * 0.072;                 // time x
  const ts = Math.round(H * 0.42);      // time font size
  const s = H * 0.32;                    // glyph height unit
  const rightPad = W * 0.06;
  // battery (rightmost)
  const bw = s * 1.6, bh = s * 0.82, br = bh * 0.28, sw = Math.max(2, s * 0.07);
  const bx = W - rightPad - bw, by = H / 2 - bh / 2;
  const tipW = s * 0.12, tipH = bh * 0.4;
  const fillPad = sw * 1.6;
  const battery = `
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${br}" ry="${br}" fill="none" stroke="#fff" stroke-width="${sw}" opacity="0.9"/>
    <rect x="${bx + bw + sw * 0.6}" y="${H / 2 - tipH / 2}" width="${tipW}" height="${tipH}" rx="${tipW * 0.4}" fill="#fff" opacity="0.5"/>
    <rect x="${bx + fillPad}" y="${by + fillPad}" width="${bw - fillPad * 2}" height="${bh - fillPad * 2}" rx="${br * 0.6}" fill="#fff"/>`;
  // wifi (left of battery): three stacked arcs + dot
  const wcx = bx - s * 1.35;            // wifi center x
  const wcy = H / 2 + s * 0.42;         // baseline (dot) y
  const wsw = Math.max(2, s * 0.13);
  const SIN45 = Math.sqrt(2) / 2;
  const arc = (r) => {
    const x0 = wcx - r * SIN45, y0 = wcy - r * SIN45;
    const x1 = wcx + r * SIN45, y1 = wcy - r * SIN45;
    return `<path d="M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}" fill="none" stroke="#fff" stroke-width="${wsw}" stroke-linecap="round"/>`;
  };
  const wifi = `${arc(s * 0.86)}${arc(s * 0.54)}<circle cx="${wcx}" cy="${wcy}" r="${wsw * 0.9}" fill="#fff"/>`;
  // cellular (left of wifi): 4 bars increasing
  const barW = s * 0.22, gap = s * 0.16;
  const ccx = wcx - s * 0.9 - (barW * 4 + gap * 3);
  const baseY = H / 2 + s * 0.5;
  let cells = "";
  for (let i = 0; i < 4; i++) {
    const hh = s * (0.4 + i * 0.2);
    cells += `<rect x="${ccx + i * (barW + gap)}" y="${baseY - hh}" width="${barW}" height="${hh}" rx="${barW * 0.3}" fill="#fff"/>`;
  }
  return `
    <text x="${cx}" y="${H / 2}" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-size="${ts}" font-weight="700" fill="#fff" letter-spacing="0.5">9:41</text>
    ${cells}${wifi}${battery}`;
}

// --- prototype: render the bar on a navy strip for visual check ---
if (process.argv[2] === "proto") {
  const W = 1080, H = 96;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#2a3a5e"/>${iosStatusBar(W, H)}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${ROOT}/_measure/proto-statusbar.png`);
  console.log("wrote proto-statusbar.png");
}
