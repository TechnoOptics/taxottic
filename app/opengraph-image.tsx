import { ImageResponse } from "next/og";

// Dynamic OpenGraph image for taxottic.com. Next.js renders this React
// component to a 1200x630 PNG at build time and ships it as
// /opengraph-image.png. Social shares (Slack, iMessage, Twitter,
// Discord, LinkedIn) auto-discover it via og:image because the layout's
// metadataBase resolves the convention path.
//
// This addresses the May 2026 audit P2 finding "No Open Graph image
// observed on the home page". Same component is referenced by
// twitter-image.tsx so the Twitter Card uses the same artwork.

export const runtime = "edge";
export const alt =
  "Taxottic — a calmer way to handle your taxes. Bank-synced forecasts, IRS-cited deductions.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
          // Forest gradient that matches the live site header.
          background:
            "linear-gradient(180deg, #1a4031 0%, #0f2d24 60%, #0a201a 100%)",
          color: "#fbf7e9",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Top row: wordmark left, family chip right. */}
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
              gap: 14,
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: -0.5,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: "linear-gradient(135deg, #d5bb7e 0%, #f2d896 100%)",
                color: "#0f2d24",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 800,
              }}
            >
              T
            </div>
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
              fontSize: 88,
              fontWeight: 600,
              lineHeight: 1.05,
              maxWidth: 1000,
              letterSpacing: -1.5,
            }}
          >
            A calmer way to{" "}
            <span style={{ color: "#f2d896" }}>handle your taxes.</span>
          </div>
          <div
            style={{
              fontSize: 28,
              color: "rgba(251, 247, 233, 0.78)",
              maxWidth: 950,
              lineHeight: 1.35,
            }}
          >
            Bank-synced forecasts, 1,025 IRS-cited deductions, and gentle
            quarterly reminders.
          </div>
        </div>

        {/* Bottom row: factual proof chips. Numbers come from the
            engine + tests, not marketing fluff. */}
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
          <span
            style={{
              padding: "10px 18px",
              border: "1px solid rgba(213, 187, 126, 0.35)",
              borderRadius: 999,
              display: "flex",
            }}
          >
            1,025 IRS-cited deductions
          </span>
          <span
            style={{
              padding: "10px 18px",
              border: "1px solid rgba(213, 187, 126, 0.35)",
              borderRadius: 999,
              display: "flex",
            }}
          >
            125 tax-math tests
          </span>
          <span
            style={{
              padding: "10px 18px",
              border: "1px solid rgba(213, 187, 126, 0.35)",
              borderRadius: 999,
              display: "flex",
            }}
          >
            Passkey + SSO
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
