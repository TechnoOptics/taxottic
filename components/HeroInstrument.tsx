import { formatCents } from "@/lib/tax/engine/money";
import { YearSpine } from "@/components/marketing/YearSpine";

export type PanelLedgerLine = { date: string; text: string; amount: string };
export type PanelSample = {
  heading: string;
  nextPaymentCents: number;
  setAsideCents: number;
  ledger: PanelLedgerLine[];
  foot: string;
};

/**
 * The instrument panel: where the reader sits in the tax year and what
 * that means in dollars. The one navy surface on a marketing page, and
 * the one place brass is spent: the spine's marker and the next payment.
 *
 * Tokens, not hex. The wrapper carries data-skin="instrument" with
 * data-theme="dark", a selector app/globals.css already defines, so every
 * token inside takes the skin's dark value. The band itself is the
 * --navy-band token so the pixel matches every other navy in the app.
 *
 * The figures and the date are a labelled sample, fixed so the visual
 * baselines stay still.
 */
export function HeroInstrument({
  taxYear,
  asOf,
  sample,
}: {
  taxYear: number;
  asOf: Date;
  sample: PanelSample;
}) {
  const still = Math.max(0, sample.nextPaymentCents - sample.setAsideCents);
  return (
    <div className="skin-scope" data-skin="instrument" data-theme="dark">
      <div
        className="rounded-[10px] p-5 sm:p-6 text-foreground shadow-[0_30px_60px_-30px_rgba(12,16,23,0.6)]"
        style={{ background: "var(--navy-band)" }}
      >
        <YearSpine taxYear={taxYear} asOf={asOf} variant="panel" trailing="Sample" markerPrefix="" />

        <dl className="mt-6">
          <div className="stat-row">
            <dt className="stat-row-label">
              Next payment
              <span className="stat-row-note block">{sample.heading}</span>
            </dt>
            <dd id="hero-next-payment" className="figure stat-row-value stat-row-value-lg stat-row-value-brass">
              {formatCents(sample.nextPaymentCents)}
            </dd>
          </div>
          <div className="stat-row">
            <dt className="stat-row-label">Set aside so far</dt>
            <dd className="figure stat-row-value stat-row-value-lg">{formatCents(sample.setAsideCents)}</dd>
          </div>
          <div className="stat-row">
            <dt className="stat-row-label">Still to set aside</dt>
            <dd className="figure stat-row-value stat-row-value-lg">{formatCents(still)}</dd>
          </div>
        </dl>

        <ul className="mt-3 border-t border-edge pt-2.5">
          {sample.ledger.map((l) => (
            <li key={l.date + l.text} className="flex gap-3 py-1.5 text-[13px]">
              <span className="figure w-12 shrink-0 text-muted">{l.date}</span>
              <span className="min-w-0 flex-1">{l.text}</span>
              <span className="figure">{l.amount}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-muted">{sample.foot}</p>
      </div>
    </div>
  );
}
