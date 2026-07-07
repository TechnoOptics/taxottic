"use client";

import { useRef, useState } from "react";

type StubRead = {
  pay_date: string | null;
  gross_cents: number | null;
  federal_withheld_cents: number | null;
  pretax_retirement_cents: number | null;
  pretax_health_cents: number | null;
  hsa_cents: number | null;
  ytd_gross_cents: number | null;
};

type Annualized = {
  frequency: string;
  periodsPerYear: number;
  basis: "ytd" | "per_period";
  annualGrossCents: number;
  annualBox1WagesCents: number;
  annualSsWagesCents: number;
  annualFederalWithheldCents: number;
  annualPretaxRetirementCents: number;
  annualPretaxHealthCents: number;
  annualHsaCents: number;
  warnings: string[];
};

type ExtractResponse = {
  extraction: {
    stubs: StubRead[];
    employer_name: string | null;
    state_code: string | null;
    confidence: number;
    notes: string | null;
  };
  annualized: Annualized;
};

const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: "Weekly (52 checks/yr)",
  biweekly: "Every two weeks (26 checks/yr)",
  semimonthly: "Twice a month (24 checks/yr)",
  monthly: "Monthly (12 checks/yr)",
};

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Pay-stub upload → annualized W-2 picture → one-click apply.
 *
 * The user picks 1-3 CONSECUTIVE stubs (consecutive checks let the
 * server infer the pay schedule from the dates). We POST to
 * /api/paystub/extract (Claude vision reads the stubs; nothing is
 * stored), show the annualized summary for review, and only on the
 * user's explicit confirm does the server action write the three
 * W-2 fields onto the tax profile that drives the forecast.
 */
export function PaystubUploader({
  applyAction,
}: {
  applyAction: (formData: FormData) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setResult(null);
    if (files.length > 3) {
      setError("Pick at most three stubs (consecutive ones work best).");
      return;
    }
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("file", f);
    setPending(true);
    try {
      const res = await fetch("/api/paystub/extract", {
        method: "POST",
        body: fd,
      });
      const body = (await res.json()) as ExtractResponse & { error?: string };
      if (!res.ok || body.error) {
        setError(body.error ?? "Couldn't read the stub. Try again.");
        return;
      }
      setResult(body);
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const a = result?.annualized ?? null;

  return (
    <div className="grid gap-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="display text-base text-forest-900">
              Upload one to three consecutive pay stubs
            </div>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed max-w-md">
              Photos, screenshots, or PDFs from your payroll portal.
              Consecutive checks let us read your pay schedule from the
              dates. Nothing is stored — the stub is read once and
              discarded.
            </p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="btn-primary text-sm shrink-0"
          >
            {pending ? "Reading…" : "Choose stubs"}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {result && a ? (
        <div className="card p-5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
            What we read
            {result.extraction.employer_name
              ? ` · ${result.extraction.employer_name}`
              : ""}
          </div>

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Pay schedule" value={FREQUENCY_LABEL[a.frequency] ?? a.frequency} small />
            <Metric label="Annualized gross" value={usd(a.annualGrossCents)} />
            <Metric label="Taxable wages (Box 1)" value={usd(a.annualBox1WagesCents)} />
            <Metric label="Federal withholding" value={usd(a.annualFederalWithheldCents)} />
          </div>

          {(a.annualPretaxRetirementCents > 0 ||
            a.annualPretaxHealthCents > 0 ||
            a.annualHsaCents > 0) ? (
            <p className="mt-3 text-xs text-ink-muted leading-relaxed">
              Pre-tax deductions found and already netted out of taxable
              wages:{" "}
              {a.annualPretaxRetirementCents > 0
                ? `retirement ${usd(a.annualPretaxRetirementCents)}/yr · `
                : ""}
              {a.annualPretaxHealthCents > 0
                ? `health premiums ${usd(a.annualPretaxHealthCents)}/yr · `
                : ""}
              {a.annualHsaCents > 0 ? `HSA ${usd(a.annualHsaCents)}/yr` : ""}
            </p>
          ) : null}

          <ul className="mt-3 grid gap-1">
            {a.basis === "ytd" ? (
              <li className="text-[11px] text-ink-muted">
                Projected from your stub&apos;s year-to-date figures (most
                accurate — it includes raises and bonuses so far).
              </li>
            ) : (
              <li className="text-[11px] text-ink-muted">
                Projected from paycheck × {a.periodsPerYear} checks/year.
              </li>
            )}
            {a.warnings.map((w) => (
              <li key={w} className="text-[11px] text-amber-800">
                {w}
              </li>
            ))}
            {result.extraction.notes ? (
              <li className="text-[11px] text-ink-muted">
                {result.extraction.notes}
              </li>
            ) : null}
          </ul>

          <form action={applyAction} className="mt-4">
            <input
              type="hidden"
              name="annual_box1_cents"
              value={a.annualBox1WagesCents}
            />
            <input
              type="hidden"
              name="annual_withheld_cents"
              value={a.annualFederalWithheldCents}
            />
            <input
              type="hidden"
              name="annual_ss_cents"
              value={a.annualSsWagesCents}
            />
            <input
              type="hidden"
              name="state_code"
              value={result.extraction.state_code ?? ""}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn-primary text-sm">
                Looks right — update my forecast
              </button>
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => setResult(null)}
              >
                Discard
              </button>
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              Writes your annual wages, withholding, and Social Security
              wages onto your tax profile — you can adjust them any time in{" "}
              <a
                href="/onboarding/tax-profile?next=/personal/forecast"
                className="underline decoration-dotted"
              >
                the profile form
              </a>
              .
            </p>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  small = false,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
        {label}
      </div>
      <div
        className={
          "text-forest-900 mt-0.5 " +
          (small ? "text-xs leading-snug" : "display text-lg tabular-nums")
        }
      >
        {value}
      </div>
    </div>
  );
}
