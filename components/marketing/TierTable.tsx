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
 * here: globals.css is unlayered and would beat the utility. Only one
 * tree is ever displayed, so the row ids live on the table rows; an id
 * on both would be a duplicate.
 *
 * The paid CTA is wrapped in <WebOnly> here rather than at the call
 * site: the control is rendered here, so the App Store 3.1.1 gate
 * belongs here too. The page hands over an href and never a rendered
 * purchase control.
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
  cta: { href: string; label: string };
  popular?: boolean;
};

/** The free tier's CTA is sign-in, not a purchase, so it needs no gate. */
const FREE_KEY = "free";

function TierCta({ tier, block }: { tier: TierRow; block?: boolean }) {
  const className =
    (tier.popular ? "btn-primary" : "btn-quiet") +
    " min-h-11" +
    (block ? " w-full" : "");
  const link = (
    <Link href={tier.cta.href} className={className}>
      {tier.cta.label}
    </Link>
  );
  if (tier.key === FREE_KEY) return link;
  return (
    <WebOnly
      fallback={
        <span className="block text-xs text-[var(--muted)]">
          Subscribe at taxottic.com
        </span>
      }
    >
      {link}
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
    <>
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
              <tr key={tier.key} id={tier.key} className="scroll-mt-24">
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
    </>
  );
}
