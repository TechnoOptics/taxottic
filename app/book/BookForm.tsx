"use client";

import { useState, useTransition } from "react";
import { submitInquiry } from "./actions";

type Audience = "firm" | "individual" | "small_business";

const AUDIENCE_OPTIONS: { value: Audience; label: string; sub: string }[] = [
  {
    value: "firm",
    label: "I run a tax-prep firm",
    sub: "Looking at moving clients onto Taxottic.",
  },
  {
    value: "small_business",
    label: "I run a small business",
    sub: "Want to track deductions and forecast taxes.",
  },
  {
    value: "individual",
    label: "I am self-employed",
    sub: "Freelancer, contractor, or sole proprietor.",
  },
];

const CLIENT_BANDS: { value: string; label: string }[] = [
  { value: "1_solo", label: "Just me" },
  { value: "2_10", label: "2 to 10 clients" },
  { value: "11_50", label: "11 to 50 clients" },
  { value: "51_200", label: "51 to 200 clients" },
  { value: "200_plus", label: "More than 200 clients" },
];

const SOFTWARE_OPTIONS: string[] = [
  "Currently using spreadsheets",
  "QuickBooks",
  "Lacerte",
  "Drake",
  "ProSeries",
  "UltraTax CS",
  "Intuit ProConnect",
  "CCH Axcess",
  "TaxAct",
  "TurboTax",
  "Other",
];

const TIMING_OPTIONS: { value: string; label: string }[] = [
  { value: "this_week", label: "This week" },
  { value: "next_week", label: "Next week" },
  { value: "this_month", label: "Within the month" },
  { value: "exploring", label: "Just exploring for now" },
];

export function BookForm({
  initialAudience,
}: {
  initialAudience: Audience;
}) {
  const [audience, setAudience] = useState<Audience>(initialAudience);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("audience", audience);
    fd.set("source_path", typeof window !== "undefined" ? window.location.pathname + window.location.search : "/book");
    startTransition(async () => {
      const r = await submitInquiry(fd);
      if (r.ok) setDone(true);
      else setError(r.error);
    });
  }

  if (done) {
    return (
      <div className="text-center py-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-gold-700">
          Thank you
        </div>
        <h2 className="display mt-2 text-2xl text-forest-900">
          Got it. We will be in touch shortly.
        </h2>
        <p className="mt-3 text-sm text-ink-soft max-w-md mx-auto leading-relaxed">
          A real person reads every inquiry that comes through this form.
          You should hear back within one business day, often sooner.
        </p>
      </div>
    );
  }

  const isFirm = audience === "firm";

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      {/* Audience picker - segmented buttons so the user knows which
          fields to expect below. */}
      <div>
        <label className="text-[11px] uppercase tracking-[0.18em] text-gold-700">
          I am here as
        </label>
        <div className="mt-2 grid sm:grid-cols-3 gap-2">
          {AUDIENCE_OPTIONS.map((opt) => {
            const active = opt.value === audience;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAudience(opt.value)}
                aria-pressed={active}
                className={
                  "text-left rounded-xl border px-3 py-3 transition-colors " +
                  (active
                    ? "border-forest-700 bg-forest-50/60 ring-1 ring-forest-300"
                    : "border-forest-100 bg-white hover:border-gold-300/60 hover:bg-cream/40")
                }
              >
                <div className="text-sm font-medium text-forest-900 leading-snug">
                  {opt.label}
                </div>
                <div className="mt-1 text-[11px] text-ink-muted leading-relaxed">
                  {opt.sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Identity */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Your name" htmlFor="full_name" required>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            autoComplete="name"
            className="input"
            placeholder="Jane Doe"
          />
        </Field>
        <Field label="Work email" htmlFor="work_email" required>
          <input
            id="work_email"
            name="work_email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            className="input"
            placeholder="jane@yourfirm.com"
          />
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={isFirm ? "Firm name" : "Company name"} htmlFor="firm_name">
          <input
            id="firm_name"
            name="firm_name"
            type="text"
            autoComplete="organization"
            className="input"
            placeholder={isFirm ? "Your CPA firm" : "Your business"}
          />
        </Field>
        <Field label="Your role" htmlFor="role_title" hint="Optional">
          <input
            id="role_title"
            name="role_title"
            type="text"
            autoComplete="organization-title"
            className="input"
            placeholder={isFirm ? "Partner, principal, ops manager..." : "Founder, owner, freelancer..."}
          />
        </Field>
      </div>

      {/* Audience-specific fields */}
      {isFirm ? (
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="How many clients?" htmlFor="client_count_band">
            <select
              id="client_count_band"
              name="client_count_band"
              defaultValue="11_50"
              className="input select"
            >
              {CLIENT_BANDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Current software" htmlFor="current_software">
            <select
              id="current_software"
              name="current_software"
              defaultValue="Lacerte"
              className="input select"
            >
              {SOFTWARE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label="What are you using today?"
            htmlFor="current_software"
          >
            <select
              id="current_software"
              name="current_software"
              defaultValue="Currently using spreadsheets"
              className="input select"
            >
              {SOFTWARE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phone (optional)" htmlFor="phone">
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              className="input"
              placeholder="(555) 123-4567"
            />
          </Field>
        </div>
      )}

      <Field label="When would you like to chat?" htmlFor="preferred_timing">
        <select
          id="preferred_timing"
          name="preferred_timing"
          defaultValue="next_week"
          className="input select"
        >
          {TIMING_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Anything we should know?"
        htmlFor="notes"
        hint="Optional - what would success look like, what you have tried, anything specific."
      >
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={4000}
          className="input resize-y min-h-[7rem] py-3 leading-relaxed"
          placeholder={
            isFirm
              ? "We're looking to move 30 clients off Lacerte by Q2. Most are Schedule C filers..."
              : "I'm a freelance designer in MA. Mostly software + travel deductions. Hoping for a calmer April..."
          }
        />
      </Field>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[11px] text-ink-muted max-w-md leading-relaxed">
          By sending this you are not signing up for anything. We will reach
          out with the next step and you can decide from there.
        </p>
        <button
          type="submit"
          className="btn-primary"
          disabled={pending}
        >
          {pending ? "Sending..." : "Send and we will reach out"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="text-[11px] uppercase tracking-[0.18em] text-gold-700 inline-flex items-baseline gap-2"
      >
        <span>{label}</span>
        {required ? (
          <span aria-hidden="true" className="text-red-700/80 normal-case tracking-normal text-[11px]">
            *
          </span>
        ) : null}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint ? (
        <div className="mt-1 text-[11px] text-ink-muted">{hint}</div>
      ) : null}
    </div>
  );
}
