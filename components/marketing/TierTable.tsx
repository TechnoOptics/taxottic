import Link from "next/link";
import { WebOnly } from "@/components/WebOnly";
import { formatTierPrice } from "@/lib/plans/format";

/**
 * The six tiers as one ruled table (spec 4.2).
 *
 * A card per tier asked the reader to compare six boxes by memory: the
 * prices sat at six different heights and nothing lined up. A table is
 * the honest shape for six rows of the same five facts, and the Year
 * grammar reads it the way a ledger reads, hairlines and a data face,
 * no chips and no ring.
 *
 * Two trees, one dataset: the table from 640px up, a stacked ledger
 * below it, because a six-column table on a 344px screen is a
 * horizontal scroll or a type size nobody can read. The swap is in
 * app/globals.css next to the rest of the block, not in `sm:hidden`
 * here: globals.css is unlayered and would beat the utility.
 *
 * Anchors: only one tree is displayed at a time, so a per-tier id can
 * only ever resolve at one width (an id in both trees would be a
 * duplicate, and the hidden copy scrolls nowhere). The whole block
 * therefore carries one id, `tiers`, which is present and displayed at
 * every width; that is what the home hero's firm CTA links to.
 *
 * The paid CTA is wrapped in <WebOnly> here, and its href is BUILT
 * inside that wrapper: the control is rendered here, so the App Store
 * 3.1.1 gate belongs here, and keeping the /billing route inside the
 * gated file is what lets lib/app-store/purchase-controls.test.ts see
 * this call site at all (it failed to, until 2026-09-19).
 */
export type TierRow = {
  key: string;
  name: string;
  tagline: string;
  monthlyCents: number;
  yearlyCents: number;
  highlights: readonly string[];
  /** Rendered as given, e.g. "1", "Unlimited", "-". */
  companies: string;
  bankLinks: string;
  cta: TierCtaSpec;
  popular?: boolean;
};

/**
 * Sign-in is a plain link. A purchase names its plan and nothing else:
 * the route to billing is assembled inside the gate below, so no caller
 * can hold a ready-made purchase href outside it.
 */
export type TierCtaSpec =
  | { kind: "signin"; href: string; label: string }
  | { kind: "purchase"; plan: string; label: string };

function TierCta({ tier, block }: { tier: TierRow; block?: boolean }) {
  const className =
    (tier.popular ? "btn-primary" : "btn-quiet") +
    " min-h-11" +
    (block ? " w-full" : "");
  if (tier.cta.kind === "signin") {
    return (
      <Link href={tier.cta.href} className={className}>
        {tier.cta.label}
      </Link>
    );
  }
  const plan = tier.cta.plan;
  const label = tier.cta.label;
  return (
    <WebOnly
      fallback={
        <span className="block text-xs text-[var(--muted)]">
          Subscribe at taxottic.com
        </span>
      }
    >
      <Link href={`/login?next=/billing&plan=${plan}`} className={className}>
        {label}
      </Link>
    </WebOnly>
  );
}

function Includes({ tier }: { tier: TierRow }) {
  return (
    <ul>
      {tier.highlights.map((line) => (
        <li key={line}>{line}</li>
      ))}
      <li>
        Companies: <span className="figure">{tier.companies}</span>
      </li>
      <li>
        Bank links: <span className="figure">{tier.bankLinks}</span>
      </li>
    </ul>
  );
}

export function TierTable({ tiers }: { tiers: readonly TierRow[] }) {
  return (
    <div id="tiers" className="scroll-mt-32">
      <div className="tier-table-desktop">
        <table className="tier-table">
          <thead>
            <tr>
              <th scope="col">Tier</th>
              <th scope="col">Who it is for</th>
              <th scope="col">Monthly</th>
              <th scope="col">Yearly</th>
              <th scope="col">Includes</th>
              <th scope="col">
                <span className="sr-only">Choose a tier</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.key}>
                <th scope="row">
                  {tier.name}
                  {tier.popular ? (
                    <span className="mono-label block mt-1">Most popular</span>
                  ) : null}
                </th>
                <td>{tier.tagline}</td>
                <td>
                  <span className="figure">
                    {formatTierPrice(tier.monthlyCents)}
                  </span>
                </td>
                <td>
                  <span className="figure">
                    {formatTierPrice(tier.yearlyCents)}
                  </span>
                </td>
                <td>
                  <Includes tier={tier} />
                </td>
                <td>
                  <TierCta tier={tier} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tier-ledger">
        {tiers.map((tier) => (
          <section key={tier.key} aria-label={tier.name}>
            <h3 className="text-lg font-semibold">
              {tier.name}
            </h3>
            {tier.popular ? (
              <span className="mono-label block">Most popular</span>
            ) : null}
            <p className="text-sm">{tier.tagline}</p>
            <div className="tier-prices">
              <span>
                <span className="mono-label block">Monthly</span>
                <span className="figure">
                  {formatTierPrice(tier.monthlyCents)}
                </span>
              </span>
              <span>
                <span className="mono-label block">Yearly</span>
                <span className="figure">
                  {formatTierPrice(tier.yearlyCents)}
                </span>
              </span>
            </div>
            <div className="tier-ledger-includes">
              <Includes tier={tier} />
            </div>
            <div className="mt-4">
              <TierCta tier={tier} block />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
