import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";

// Dynamic OpenGraph image for taxottic.com. Next.js renders this React
// component to a 1200x630 PNG and ships it as /opengraph-image.png. Social
// shares (Slack, iMessage, Twitter, Discord, LinkedIn), search-result rich
// previews, and LLM link unfurls all auto-discover it via og:image because
// the layout's metadataBase resolves the convention path. twitter-image
// reuses the same artwork through the Twitter Card metadata.
//
// Refreshed to the current positioning — "Know what you'll owe. Maximize
// your deductions." — matching the app-store feature graphic, and now uses
// the real cream brand mark instead of a placeholder letter tile.

// Node runtime so we can inline the brand mark from disk as a data URI —
// reliable at build/request time on Vercel (public/ ships with the bundle),
// with no remote fetch that could fail and break the preview image.
export const alt =
  "Taxottic — know what you'll owe and maximize your deductions. Year-round tax forecasts, automatic mileage tracking, and 1,025 IRS-cited deductions, synced to your bank.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

let logoSrc: string | null = null;
try {
  const buf = readFileSync(
    join(process.cwd(), "public/brand/icon-mark-cream-1024.png"),
  );
  logoSrc = `data:image/png;base64,${buf.toString("base64")}`;
} catch {
  // Fall back to the text wordmark alone if the mark can't be read.
  logoSrc = null;
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          // Navy gradient that matches the live app header + the store
          // feature graphic.
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
          color: "#fbf7e9",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Top row: real brand mark + wordmark left, maker chip right. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: -0.5,
            }}
          >
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} width={56} height={56} alt="" />
            ) : null}
            <span>Taxottic</span>
          </div>
          <div
            style={{
              fontSize: 18,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "rgba(213, 187, 126, 0.8)",
              display: "flex",
            }}
          >
            Made by Techno Optics
          </div>
        </div>

        {/* Headline + supporting line. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 84,
              fontWeight: 600,
              lineHeight: 1.04,
              maxWidth: 1040,
              letterSpacing: -1.5,
            }}
          >
            <span>Know what you&apos;ll owe.</span>
            <span style={{ color: "#f2d896" }}>Maximize your deductions.</span>
          </div>
          <div
            style={{
              fontSize: 27,
              color: "rgba(251, 247, 233, 0.78)",
              maxWidth: 980,
              lineHeight: 1.35,
              display: "flex",
            }}
          >
            Year-round tax forecasts, automatic mileage tracking, and 1,025
            IRS-cited deductions — synced to your bank.
          </div>
        </div>

        {/* Bottom row: factual proof chips. */}
        <div
          style={{
            display: "flex",
            gap: 16,
            fontSize: 18,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: "rgba(213, 187, 126, 0.9)",
          }}
        >
          {[
            "Year-round forecast",
            "Automatic mileage + map",
            "1,025 IRS-cited deductions",
          ].map((label) => (
            <span
              key={label}
              style={{
                padding: "10px 18px",
                border: "1px solid rgba(213, 187, 126, 0.35)",
                borderRadius: 999,
                display: "flex",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
