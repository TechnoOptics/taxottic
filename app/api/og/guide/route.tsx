import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";
import type { NextRequest } from "next/server";

/**
 * Dynamic OG image for /guides/* articles.
 *
 * GET /api/og/guide?title=<guide title>&kicker=<optional eyebrow> → a
 * 1200×630 branded card carrying the guide's own title, so a shared
 * guide link shows a bespoke, on-brand preview instead of no image.
 * Mirrors /api/og/calc's artwork so the marketing surface is coherent.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

let logoSrc: string | null = null;
try {
  const buf = readFileSync(
    join(process.cwd(), "public/brand/icon-mark-cream-1024.png"),
  );
  logoSrc = `data:image/png;base64,${buf.toString("base64")}`;
} catch {
  logoSrc = null;
}

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const title = (sp.get("title") || "Taxottic guide").slice(0, 120);
  const kicker = (sp.get("kicker") || "Free guide").slice(0, 40);

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
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
          color: "#fbf7e9",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
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
              fontSize: 38,
              fontWeight: 700,
              letterSpacing: -0.5,
            }}
          >
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} width={52} height={52} alt="" />
            ) : null}
            <span>Taxottic</span>
          </div>
          <div
            style={{
              fontSize: 18,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "rgba(213, 187, 126, 0.85)",
              display: "flex",
            }}
          >
            {kicker}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 68,
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: -1.5,
            maxWidth: 1040,
            color: "#f7edd2",
          }}
        >
          {title}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 22,
            letterSpacing: 1,
            color: "rgba(213, 187, 126, 0.9)",
          }}
        >
          taxottic.com/guides
        </div>
      </div>
    ),
    { ...size },
  );
}
