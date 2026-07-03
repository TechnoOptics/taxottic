import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";
import type { NextRequest } from "next/server";
import { forecast, formatCents, type ForecastInput } from "@/lib/tax/forecast";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import { neutralForecastInput, toCents } from "@/lib/calculators/base-input";

/**
 * Dynamic OG image for a shared self-employment-tax-calculator result.
 *
 * GET /api/og/se-tax?income=80000&expenses=12000&filing=single&state=CA
 * → a 1200×630 branded card showing the estimated total tax + effective
 * rate for those inputs, so a shared calculator link unfurls into a
 * compelling preview on iMessage / Slack / X / LinkedIn instead of a
 * bare URL. When no income is supplied it renders a generic
 * "free calculator" card. Same forecast engine as the calculator, so
 * the preview number always matches the page.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TAX_YEAR = 2026;

let logoSrc: string | null = null;
try {
  const buf = readFileSync(
    join(process.cwd(), "public/brand/icon-mark-cream-1024.png"),
  );
  logoSrc = `data:image/png;base64,${buf.toString("base64")}`;
} catch {
  logoSrc = null;
}

const VALID_FILING: FilingStatus[] = [
  "single",
  "married_filing_jointly",
  "married_filing_separately",
  "head_of_household",
  "qualifying_widow",
];

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const gross = Math.max(0, Number(sp.get("income")) || 0);
  const expenses = Math.max(0, Number(sp.get("expenses")) || 0);
  const filingRaw = sp.get("filing") as FilingStatus | null;
  const filing: FilingStatus =
    filingRaw && VALID_FILING.includes(filingRaw) ? filingRaw : "single";
  const state = (sp.get("state") || "").toUpperCase().slice(0, 2);

  const hasResult = gross > 0;
  let totalLabel = "";
  let effectiveLabel = "";
  if (hasResult) {
    const input: ForecastInput = {
      ...neutralForecastInput(TAX_YEAR, filing),
      stateCode: state || null,
      ytdIncomeCents: toCents(gross),
      ytdBusinessExpensesCents: toCents(expenses),
    };
    const r = forecast(input);
    totalLabel = formatCents(r.totalTaxCents);
    effectiveLabel = `${(r.effectiveRate * 100).toFixed(1)}% effective rate`;
  }

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
            Self-Employment Tax · {TAX_YEAR}
          </div>
        </div>

        {hasResult ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                fontSize: 26,
                color: "rgba(251, 247, 233, 0.7)",
                display: "flex",
              }}
            >
              Estimated total tax on{" "}
              {formatCents(toCents(Math.max(0, gross - expenses)))} net
              self-employment income
            </div>
            <div
              style={{
                fontSize: 150,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: -3,
                color: "#f2d896",
                display: "flex",
              }}
            >
              {totalLabel}
            </div>
            <div
              style={{
                fontSize: 30,
                color: "rgba(251, 247, 233, 0.82)",
                display: "flex",
              }}
            >
              {effectiveLabel} · federal + state + self-employment tax
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontSize: 78,
                fontWeight: 600,
                lineHeight: 1.05,
                letterSpacing: -1.5,
                maxWidth: 1040,
              }}
            >
              <span>Free Self-Employment</span>
              <span style={{ color: "#f2d896" }}>Tax Calculator</span>
            </div>
            <div
              style={{
                fontSize: 27,
                color: "rgba(251, 247, 233, 0.78)",
                maxWidth: 960,
                lineHeight: 1.35,
                display: "flex",
              }}
            >
              See what you&apos;ll owe on 1099 income — self-employment tax,
              federal + state, and quarterly payments. Instant, no sign-up.
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            fontSize: 22,
            letterSpacing: 1,
            color: "rgba(213, 187, 126, 0.9)",
          }}
        >
          taxottic.com/calculators/self-employment-tax
        </div>
      </div>
    ),
    { ...size },
  );
}
