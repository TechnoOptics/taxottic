"use client";

import { useRef, useState } from "react";
import { PdfPasswordPrompt } from "./PdfPasswordPrompt";

type W2Result = {
  wages_cents: number | null;
  federal_income_tax_withheld_cents: number | null;
  social_security_wages_cents: number | null;
  state_code: string | null;
  employer_name: string | null;
  tax_year: number | null;
  confidence: number;
  notes: string | null;
};

type Props = {
  /** Either "owner" (you) or "spouse" - controls which input names
   *  the extracted values get assigned to. */
  who: "owner" | "spouse";
  /** Called with the parsed W-2 fields when the user accepts the
   *  extraction. The parent form takes care of writing them onto
   *  hidden inputs / state. */
  onApply: (fields: {
    who: "owner" | "spouse";
    wagesCents: number;
    withheldCents: number;
    ssWagesCents: number;
    stateCode: string | null;
  }) => void;
};

const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

/**
 * One-click W-2 upload that calls /api/w2/extract (Anthropic vision)
 * and surfaces the extracted boxes for the user to review before
 * applying. We don't auto-apply blindly - the user clicks Confirm
 * after eyeballing the numbers.
 *
 * Accepts photos, screenshots, and PDFs. The file isn't persisted;
 * we read it server-side, ask Claude to read the boxes, return the
 * JSON, and the caller pours that into the existing tax-profile
 * form fields.
 */
export function W2Uploader({ who, onApply }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<W2Result | null>(null);
  // When the server returns 422 with pdf_password_required we stash the
  // file, pop the password modal, and retry on submit.
  const [pendingPasswordFile, setPendingPasswordFile] = useState<File | null>(null);
  const [wrongAttempt, setWrongAttempt] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadOnce(file: File, password?: string) {
    const fd = new FormData();
    fd.set("file", file);
    if (password) fd.set("password", password);
    const res = await fetch("/api/w2/extract", { method: "POST", body: fd });
    return res;
  }

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    if (file.size > 8 * 1024 * 1024) {
      setError("File must be 8 MB or smaller.");
      return;
    }
    setPending(true);
    try {
      const res = await uploadOnce(file);
      if (res.status === 422) {
        const body = await res.json().catch(() => ({}));
        if (body?.error === "pdf_password_required") {
          setPendingPasswordFile(file);
          setWrongAttempt(false);
          return;
        }
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `Upload failed (${res.status})`);
      }
      const data = (await res.json()) as W2Result;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setPending(false);
    }
  }

  async function submitWithPassword(password: string) {
    if (!pendingPasswordFile) return;
    const file = pendingPasswordFile;
    setError(null);
    setPending(true);
    try {
      const res = await uploadOnce(file, password);
      if (res.status === 422) {
        const body = await res.json().catch(() => ({}));
        if (body?.error === "pdf_password_required") {
          setWrongAttempt(true);
          return;
        }
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `Upload failed (${res.status})`);
      }
      const data = (await res.json()) as W2Result;
      setResult(data);
      setPendingPasswordFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
      setPendingPasswordFile(null);
    } finally {
      setPending(false);
    }
  }

  function applyResult() {
    if (!result) return;
    onApply({
      who,
      wagesCents: result.wages_cents ?? 0,
      withheldCents: result.federal_income_tax_withheld_cents ?? 0,
      ssWagesCents: result.social_security_wages_cents ?? 0,
      stateCode: result.state_code,
    });
    setResult(null);
  }

  const label =
    who === "owner" ? "Upload your W-2" : "Upload spouse's W-2";

  return (
    <div className="rounded-xl border border-dashed border-forest-200 bg-cream/50 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-medium text-forest-800">
            {label}
          </div>
          <p className="text-xs text-ink-muted mt-0.5 leading-relaxed max-w-md">
            Drop in a PDF, photo, or screenshot. We pull out wages,
            withholding, and Social-Security wages so you don&apos;t have
            to type them. Review the extracted values before applying.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="btn-ghost text-sm"
        >
          {pending ? "Reading..." : "Choose file"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : null}

      {pendingPasswordFile ? (
        <PdfPasswordPrompt
          fileName={pendingPasswordFile.name}
          wrongAttempt={wrongAttempt}
          onSubmit={submitWithPassword}
          onCancel={() => {
            setPendingPasswordFile(null);
            setWrongAttempt(false);
          }}
        />
      ) : null}

      {result ? (
        <div className="mt-4 rounded-lg bg-white border border-forest-100 p-4 grid gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
              Extracted from your W-2
            </div>
            <span
              className={
                "text-[10px] uppercase tracking-wide " +
                (result.confidence >= 0.85
                  ? "text-emerald-800"
                  : result.confidence >= 0.6
                    ? "text-gold-700"
                    : "text-red-700")
              }
            >
              {result.confidence >= 0.85
                ? "High confidence"
                : result.confidence >= 0.6
                  ? "Medium confidence"
                  : "Low confidence - double-check"}
            </span>
          </div>
          {result.employer_name || result.tax_year ? (
            <div className="text-xs text-ink-muted">
              {[result.employer_name, result.tax_year]
                .filter(Boolean)
                .join(" · ")}
            </div>
          ) : null}
          <ul className="grid grid-cols-2 gap-2 text-sm">
            <Field label="Wages (Box 1)" cents={result.wages_cents} />
            <Field
              label="Withheld (Box 2)"
              cents={result.federal_income_tax_withheld_cents}
            />
            <Field
              label="SS wages (Box 3)"
              cents={result.social_security_wages_cents}
            />
            <Field label="State" raw={result.state_code ?? "-"} />
          </ul>
          {result.notes ? (
            <p className="text-[11px] text-ink-muted italic">
              Note from the reader: {result.notes}
            </p>
          ) : null}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={applyResult}
              className="btn-primary text-sm"
            >
              Apply to form
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="text-xs text-ink-muted hover:text-forest-900"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  cents,
  raw,
}: {
  label: string;
  cents?: number | null;
  raw?: string;
}) {
  const display =
    raw ??
    (cents == null
      ? "-"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(cents / 100));
  return (
    <li className="rounded bg-cream/50 border border-forest-100 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gold-700">
        {label}
      </div>
      <div className="text-forest-900 tabular-nums mt-0.5">{display}</div>
    </li>
  );
}
