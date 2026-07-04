import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";
import type { NextRequest } from "next/server";
import { forecast, formatCents, type ForecastInput } from "@/lib/tax/forecast";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import { getTaxYearConstants } from "@/lib/tax/constants";
import { neutralForecastInput, toCents } from "@/lib/calculators/base-input";

/**
 * One dynamic OG image for every free calculator.
 *
 * GET /api/og/calc?calc=<type>&…inputs → a 1200×630 branded card whose
 * headline reflects the shared result, computed from the same forecast
 * engine as the calculator itself (so preview == page). Falls back to a
 * clean "free calculator" card when no inputs are present. One route
 * instead of six keeps the artwork + branding in a single place.
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

type Card = {
  eyebrow: string;
  emptyHeadline: [string, string];
  emptyBlurb: string;
  path: string;
  result: { context: string; big: string; sub: string } | null;
};

function num(v: string | null): number {
  return Math.max(0, Number(v) || 0);
}

function seForecast(sp: URLSearchParams) {
  const gross = num(sp.get("income"));
  const expenses = num(sp.get("expenses"));
  const filingRaw = sp.get("filing") as FilingStatus | null;
  const filing =
    filingRaw && VALID_FILING.includes(filingRaw) ? filingRaw : "single";
  const state = (sp.get("state") || "").toUpperCase().slice(0, 2);
  const input: ForecastInput = {
    ...neutralForecastInput(TAX_YEAR, filing),
    stateCode: state || null,
    ytdIncomeCents: toCents(gross),
    ytdBusinessExpensesCents: toCents(expenses),
  };
  return { gross, expenses, net: Math.max(0, gross - expenses), r: forecast(input) };
}

function buildCard(sp: URLSearchParams): Card {
  const calc = sp.get("calc") || "se-tax";

  switch (calc) {
    case "quarterly": {
      const base: Card = {
        eyebrow: "Quarterly Estimated Tax · 2026",
        emptyHeadline: ["Free Quarterly", "Estimated Tax Calculator"],
        emptyBlurb:
          "Work out what to send the IRS each quarter on your self-employment income — all four payments and due dates.",
        path: "calculators/quarterly-estimated-tax",
        result: null,
      };
      if (!num(sp.get("income"))) return base;
      const { net, r } = seForecast(sp);
      return {
        ...base,
        result: {
          context: `Estimated ${TAX_YEAR} tax on ${formatCents(toCents(net))} net self-employment income`,
          big: formatCents(r.totalTaxCents),
          sub: "Sent in 4 quarterly payments · federal + state + SE tax",
        },
      };
    }
    case "1099": {
      const base: Card = {
        eyebrow: "1099 Tax · 2026",
        emptyHeadline: ["Free 1099", "Tax Calculator"],
        emptyBlurb:
          "See what you owe on 1099-NEC and 1099-K income — self-employment tax, federal + state, and quarterly payments.",
        path: "calculators/1099-tax",
        result: null,
      };
      if (!num(sp.get("income"))) return base;
      const { net, r } = seForecast(sp);
      return {
        ...base,
        result: {
          context: `Estimated ${TAX_YEAR} tax on ${formatCents(toCents(net))} of 1099 income`,
          big: formatCents(r.totalTaxCents),
          sub: `${(r.effectiveRate * 100).toFixed(1)}% effective rate · federal + state + SE tax`,
        },
      };
    }
    case "mileage": {
      const base: Card = {
        eyebrow: "Mileage Deduction · 2026",
        emptyHeadline: ["Free Mileage", "Deduction Calculator"],
        emptyBlurb:
          "Turn your business miles into a tax deduction at the 2026 IRS rate — and see roughly what it saves you.",
        path: "calculators/mileage-deduction",
        result: null,
      };
      const miles = num(sp.get("miles"));
      if (!miles) return base;
      const ratePerMile = getTaxYearConstants(TAX_YEAR).MILEAGE_RATE_PER_MILE_CENTS;
      const savingsRate = Math.min(0.5, Math.max(0, Number(sp.get("rate")) || 0.3));
      const deduction = Math.round(miles * ratePerMile);
      return {
        ...base,
        result: {
          context: `${miles.toLocaleString()} business miles × ${ratePerMile}¢/mile`,
          big: formatCents(deduction),
          sub: `Mileage deduction · ≈ ${formatCents(Math.round(deduction * savingsRate))} in tax savings`,
        },
      };
    }
    case "set-aside": {
      const base: Card = {
        eyebrow: "Tax Set-Aside · 2026",
        emptyHeadline: ["How Much to Set", "Aside for Taxes"],
        emptyBlurb:
          "The exact percentage of every payment to move into savings so quarterly taxes are covered and April is calm.",
        path: "calculators/how-much-to-set-aside",
        result: null,
      };
      const gross = num(sp.get("income"));
      if (!gross) return base;
      const { r } = seForecast(sp);
      const pct = r.totalTaxCents / toCents(gross);
      return {
        ...base,
        result: {
          context: "Set aside this much of every payment",
          big: `${(pct * 100).toFixed(0)}%`,
          sub: `${formatCents(Math.round(pct * 100000))} per $1,000 earned · self-employment + income tax`,
        },
      };
    }
    case "effective": {
      const base: Card = {
        eyebrow: "Effective Tax Rate · 2026",
        emptyHeadline: ["Free Effective", "Tax Rate Calculator"],
        emptyBlurb:
          "See what you actually pay — effective rate, marginal bracket, and after-tax take-home. W-2 or self-employment.",
        path: "calculators/effective-tax-rate",
        result: null,
      };
      const income = num(sp.get("income"));
      if (!income) return base;
      const filingRaw = sp.get("filing") as FilingStatus | null;
      const filing =
        filingRaw && VALID_FILING.includes(filingRaw) ? filingRaw : "single";
      const state = (sp.get("state") || "").toUpperCase().slice(0, 2);
      const type = sp.get("type") === "self" ? "self" : "w2";
      const cents = toCents(income);
      const b = neutralForecastInput(TAX_YEAR, filing);
      const input: ForecastInput =
        type === "self"
          ? { ...b, stateCode: state || null, ytdIncomeCents: cents }
          : {
              ...b,
              stateCode: state || null,
              ytdIncomeCents: 0,
              ownerW2WagesCents: cents,
              ownerW2SsWagesCents: cents,
            };
      const r = forecast(input);
      const eff = cents > 0 ? r.totalTaxCents / cents : 0;
      return {
        ...base,
        result: {
          context: `Effective tax rate on ${formatCents(cents)} income`,
          big: `${(eff * 100).toFixed(1)}%`,
          sub: `${formatCents(r.totalTaxCents)} tax · ${formatCents(cents - r.totalTaxCents)} after-tax take-home`,
        },
      };
    }
    // se-tax (default)
    default: {
      const base: Card = {
        eyebrow: "Self-Employment Tax · 2026",
        emptyHeadline: ["Free Self-Employment", "Tax Calculator"],
        emptyBlurb:
          "See what you'll owe on 1099 income — self-employment tax, federal + state, and quarterly payments. No sign-up.",
        path: "calculators/self-employment-tax",
        result: null,
      };
      if (!num(sp.get("income"))) return base;
      const { net, r } = seForecast(sp);
      return {
        ...base,
        result: {
          context: `Estimated total tax on ${formatCents(toCents(net))} net self-employment income`,
          big: formatCents(r.totalTaxCents),
          sub: `${(r.effectiveRate * 100).toFixed(1)}% effective rate · federal + state + self-employment tax`,
        },
      };
    }
  }
}

export function GET(req: NextRequest) {
  const card = buildCard(req.nextUrl.searchParams);
  // Optional eyebrow override — used by the per-state pages to show
  // "Self-Employment Tax · California" instead of the generic label.
  const labelOverride = req.nextUrl.searchParams.get("label");
  if (labelOverride) card.eyebrow = labelOverride.slice(0, 60);

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
            {card.eyebrow}
          </div>
        </div>

        {card.result ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                fontSize: 26,
                color: "rgba(251, 247, 233, 0.7)",
                display: "flex",
                maxWidth: 1040,
              }}
            >
              {card.result.context}
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
              {card.result.big}
            </div>
            <div
              style={{
                fontSize: 30,
                color: "rgba(251, 247, 233, 0.82)",
                display: "flex",
                maxWidth: 1040,
              }}
            >
              {card.result.sub}
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
              <span>{card.emptyHeadline[0]}</span>
              <span style={{ color: "#f2d896" }}>{card.emptyHeadline[1]}</span>
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
              {card.emptyBlurb}
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
          taxottic.com/{card.path}
        </div>
      </div>
    ),
    { ...size },
  );
}
