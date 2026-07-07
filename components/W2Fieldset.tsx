"use client";

import { useState } from "react";
import { W2Uploader } from "./W2Uploader";

type Props = {
  who: "owner" | "spouse";
  legend: string;
  description: string;
  /** Names of the three hidden inputs - lets the parent server form
   *  read them via FormData on submit. */
  fieldNames: {
    wages: string;
    withheld: string;
    ssWages: string;
  };
  initial: {
    wagesCents: number;
    withheldCents: number;
    ssWagesCents: number;
  };
  /** Helper hint placed under the SS-wages input. Differs by side. */
  ssHint?: string;
};

/**
 * Three-input fieldset (annual wages / federal withholding / SS
 * wages) PLUS a W-2 uploader that writes directly to the inputs
 * when the user accepts an extraction. Sitting inside the existing
 * tax-profile <form action={saveTaxProfile}>, so submission picks up
 * whatever is currently in state.
 */
export function W2Fieldset({
  who,
  legend,
  description,
  fieldNames,
  initial,
  ssHint,
}: Props) {
  const [wages, setWages] = useState<string>(
    initial.wagesCents > 0 ? (initial.wagesCents / 100).toFixed(0) : "",
  );
  const [withheld, setWithheld] = useState<string>(
    initial.withheldCents > 0 ? (initial.withheldCents / 100).toFixed(0) : "",
  );
  const [ssWages, setSsWages] = useState<string>(
    initial.ssWagesCents > 0 ? (initial.ssWagesCents / 100).toFixed(0) : "",
  );

  function applyExtraction(fields: {
    who: "owner" | "spouse";
    wagesCents: number;
    withheldCents: number;
    ssWagesCents: number;
    stateCode: string | null;
  }) {
    if (fields.wagesCents > 0)
      setWages((fields.wagesCents / 100).toFixed(0));
    if (fields.withheldCents > 0)
      setWithheld((fields.withheldCents / 100).toFixed(0));
    if (fields.ssWagesCents > 0)
      setSsWages((fields.ssWagesCents / 100).toFixed(0));
  }

  return (
    <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-forest-100 pt-5">
      <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
        {legend}
      </legend>
      <p className="sm:col-span-3 text-xs text-ink-muted -mt-1 leading-relaxed">
        {description}
      </p>
      <div className="sm:col-span-3">
        <W2Uploader who={who} onApply={applyExtraction} />
        {who === "owner" ? (
          <p className="mt-1.5 text-[11px] text-ink-muted">
            No W-2 yet this year?{" "}
            <a
              href="/personal/paystub"
              className="text-forest-700 underline decoration-dotted hover:text-forest-900"
            >
              Upload 1-3 recent pay stubs instead
            </a>{" "}
            and we&apos;ll project the full year from them.
          </p>
        ) : null}
      </div>
      <Field
        name={fieldNames.wages}
        label="Annual W-2 wages"
        value={wages}
        onChange={setWages}
      />
      <Field
        name={fieldNames.withheld}
        label="Federal tax withheld"
        value={withheld}
        onChange={setWithheld}
      />
      <Field
        name={fieldNames.ssWages}
        label="Social Security wages"
        value={ssWages}
        onChange={setSsWages}
        hint={ssHint}
      />
    </fieldset>
  );
}

function Field({
  name,
  label,
  value,
  onChange,
  hint,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-forest-800">{label}</span>
      <input
        name={name}
        type="text"
        inputMode="decimal"
        className="input"
        placeholder="$0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}
