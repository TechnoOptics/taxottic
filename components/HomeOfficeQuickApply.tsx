"use client";

import { useRef, useState, type FormEvent } from "react";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";

type Props = {
  publicId: string;
  /** Current applied state, if any. */
  applied: boolean;
  /** Existing values to pre-fill the form on edit/re-apply. */
  initialSqft: number | null;
  initialTotalSqft: number | null;
  /** Server actions. Passed in so the boundary stays clean. */
  applyAction: (fd: FormData) => Promise<void>;
  unapplyAction: (fd: FormData) => Promise<void>;
};

/**
 * Home Office (Form 8829) quick-apply.
 *
 * One-click apply for the deduction users miss most. Click "Apply"
 * → modal collects office sq ft + total home sq ft → server upserts
 * business_profiles + flips has_home_office=true → the forecast
 * pipeline picks it up immediately. Already-applied state shows the
 * sqft on file with "Update" + "Remove" buttons.
 *
 * The math the IRS lets you choose between (simplified $5/sqft up to
 * 300 sqft, or actual %-of-home of utilities/rent/insurance/etc.) is
 * picked downstream by the forecaster. Here we just need the sqft.
 */
export function HomeOfficeQuickApply({
  publicId,
  applied,
  initialSqft,
  initialTotalSqft,
  applyAction,
  unapplyAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  useFocusTrap(dialogRef, open);

  // Compute business-use % live for the user. The whole point of
  // showing this is that they can see immediately whether they're
  // about to claim 5% (too small to bother) or 25% (worth it).
  const [sqft, setSqft] = useState<string>(initialSqft?.toString() ?? "");
  const [total, setTotal] = useState<string>(initialTotalSqft?.toString() ?? "");
  const sqftN = Number(sqft);
  const totalN = Number(total);
  const pct =
    Number.isFinite(sqftN) &&
    Number.isFinite(totalN) &&
    totalN > 0 &&
    sqftN > 0 &&
    sqftN <= totalN
      ? Math.round((sqftN / totalN) * 1000) / 10
      : null;
  const simplifiedAnnualDollars =
    Number.isFinite(sqftN) && sqftN > 0
      ? // IRS simplified method: $5/sqft, capped at 300 sqft → $1,500 max.
        Math.min(sqftN, 300) * 5
      : 0;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      await applyAction(fd);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setPending(false);
    }
  }

  async function onUnapply() {
    if (
      !window.confirm(
        "Remove Home Office from this year's deductions? The square footage stays on file.",
      )
    ) {
      return;
    }
    setError(null);
    setPending(true);
    const fd = new FormData();
    fd.set("publicId", publicId);
    try {
      await unapplyAction(fd);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card p-5 sm:p-6 relative">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
            Form 8829
          </div>
          <h3 className="display mt-1 text-lg text-forest-900">
            Home office deduction
          </h3>
          <p className="mt-1 text-sm text-ink-soft leading-relaxed">
            If you use part of your home regularly and exclusively for
            business, you can deduct a share of rent, utilities,
            insurance, and depreciation. Two clicks.
          </p>
        </div>
        {applied ? (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1 font-medium">
            <svg
              className="size-3"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z"
                clipRule="evenodd"
              />
            </svg>
            Applied
          </span>
        ) : null}
      </div>

      {applied && initialSqft && initialTotalSqft ? (
        <div className="mt-4 rounded-xl border border-forest-100 bg-cream/40 px-4 py-3 text-sm text-forest-800">
          <span className="font-medium">{initialSqft.toLocaleString("en-US")}</span>{" "}
          sq ft office of{" "}
          <span className="font-medium">{initialTotalSqft.toLocaleString("en-US")}</span>{" "}
          sq ft home
          {", "}
          <span className="text-ink-soft">
            {Math.round((initialSqft / initialTotalSqft) * 1000) / 10}% business
            use
          </span>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
          className={applied ? "btn-ghost text-sm" : "btn-primary text-sm"}
          disabled={pending}
        >
          {applied ? "Update home office" : "Apply home office"}
        </button>
        {applied ? (
          <button
            type="button"
            onClick={onUnapply}
            disabled={pending}
            className="text-xs text-red-700 hover:text-red-900 underline underline-offset-2"
          >
            Remove
          </button>
        ) : null}
        <a
          href="https://www.irs.gov/forms-pubs/about-form-8829"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
        >
          IRS Form 8829 ↗
        </a>
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Home office deduction"
          className="fixed inset-0 z-50 grid place-items-center px-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div className="absolute inset-0 bg-forest-900/60 backdrop-blur-md" />
          <form
            ref={dialogRef}
            onSubmit={onSubmit}
            onClick={(e) => e.stopPropagation()}
            className="card relative w-full max-w-md p-6 sm:p-7"
          >
            <input type="hidden" name="publicId" value={publicId} />
            <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
              Form 8829
            </div>
            <h2 className="display mt-1 text-xl text-forest-900">
              Home office details
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              Tell us how much of your home is the office. The space has
              to be used regularly AND exclusively for business, a
              shared dining table won&apos;t qualify.
            </p>

            <div className="mt-5 grid sm:grid-cols-2 gap-3">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-forest-800">
                  Office sq ft
                </span>
                <input
                  name="home_office_sqft"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={sqft}
                  onChange={(e) => setSqft(e.target.value)}
                  placeholder="120"
                  className="input"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-forest-800">
                  Total home sq ft
                </span>
                <input
                  name="home_total_sqft"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  placeholder="1200"
                  className="input"
                />
              </label>
            </div>

            {pct != null ? (
              <div className="mt-4 rounded-xl border border-gold-200 bg-gold-50 px-4 py-3 text-sm text-forest-800">
                <div className="display text-lg text-forest-900">
                  {pct}% business use
                </div>
                <div className="mt-1 text-xs text-ink-soft leading-relaxed">
                  {pct < 5
                    ? "That's small, the simplified method might net more after the deductibility math."
                    : pct > 35
                      ? "Anything over ~30% tends to raise questions at audit. Make sure the room is genuinely used only for business."
                      : "Healthy range, the deduction will move the forecast meaningfully."}
                </div>
                <div className="mt-2 text-xs text-ink-soft">
                  Simplified method estimate:{" "}
                  <span className="font-medium text-forest-900">
                    ${simplifiedAnnualDollars.toLocaleString("en-US")}/yr
                  </span>{" "}
                  <span className="text-ink-muted">
                    (the actual-expenses method usually beats this once
                    rent/utilities are pulled in)
                  </span>
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="btn-ghost text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="btn-primary text-sm"
              >
                {pending ? "Saving…" : "Apply"}
              </button>
            </div>

            {error ? (
              <p className="mt-3 text-sm text-red-700">{error}</p>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}
