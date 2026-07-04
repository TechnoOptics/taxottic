import Link from "next/link";

/**
 * Forecast / advice distinction disclaimer.
 *
 * Renders a one-line link-out to the legal terms with optional
 * expansion. Placed at the foot of every page that displays a tax
 * forecast number, refund estimate, or amount-owed figure. Three
 * variants:
 *
 *   - `compact` (default): single line, link-styled. Best inside
 *     dashboards where the existing copy already establishes
 *     context.
 *   - `card`: a full card with title + body. Best for first-time
 *     onboarding screens.
 *   - `inline`: italics inline text. Best for tooltips.
 *
 * The text is identical across variants so the legal language we
 * commit to is consistent across the app.
 *
 * Why this exists:
 *   We want a single canonical surface stating "this is a forecast,
 *   not tax advice." Sprinkling that sentence into 30 page-level
 *   components made it impossible to update without missing one;
 *   centralizing it here means a single edit changes every
 *   surface.
 */
export function ForecastDisclaimer({
  variant = "compact",
}: {
  variant?: "compact" | "card" | "inline";
}) {
  if (variant === "card") {
    return (
      <aside
        role="note"
        aria-labelledby="forecast-disclaimer-title"
        className="rounded-2xl border border-cream-300 bg-cream-100 p-4 sm:p-5 text-[12px] sm:text-sm text-ink-soft leading-relaxed"
      >
        <h3
          id="forecast-disclaimer-title"
          className="display text-sm sm:text-base text-forest-900 mb-2"
        >
          A forecast, not tax advice.
        </h3>
        <p>
          Numbers Taxottic shows you, projected tax owed, refund
          estimate, quarterly payment recommendation, generated
          Schedule C or K-1 draft, are <strong>forecasts</strong>{" "}
          based on the books you&apos;ve entered and current-year
          tax tables. They are not tax advice, legal advice, or a
          filed return. Before you make a payment to the IRS, sign
          a tax form, or rely on a generated draft, have a licensed
          tax professional review the work.
        </p>
        <p className="mt-2 text-[11px] text-ink-muted">
          See the{" "}
          <Link
            href="/legal/terms#forecast-vs-advice"
            className="underline hover:text-forest-800"
          >
            full terms
          </Link>{" "}
          for the legal language.
        </p>
      </aside>
    );
  }

  if (variant === "inline") {
    return (
      <em className="text-[11px] text-ink-muted">
        Forecast only, not tax advice.{" "}
        <Link
          href="/legal/terms#forecast-vs-advice"
          className="underline hover:text-forest-800"
        >
          Details
        </Link>
        .
      </em>
    );
  }

  return (
    <p className="text-[11px] text-ink-muted leading-relaxed">
      The figures above are a <strong>forecast</strong>, not tax
      advice. Verify with a licensed tax professional before paying,
      signing, or filing.{" "}
      <Link
        href="/legal/terms#forecast-vs-advice"
        className="underline hover:text-forest-800"
      >
        Forecast vs. tax advice
      </Link>
      .
    </p>
  );
}
