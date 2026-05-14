"use client";

import { useState } from "react";

type Category = {
  code: string;
  label: string;
  is_meal: boolean;
  is_typically_recurring: boolean;
};

type Extraction = {
  vendor: string | null;
  date: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  tip_cents: number | null;
  total_cents: number | null;
  payment_method: string | null;
  suggested_category: string | null;
  description: string | null;
  confidence: number;
  notes: string | null;
};

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Drop a receipt photo or PDF; we read it with Bella and pre-fill the
 * "Add an expense" form so the user can confirm with one click. The
 * commit goes through the existing addExpense server action so we
 * inherit auth, validation, and revalidation paths for free.
 */
export function ReceiptUploader({
  companyId,
  taxYear,
  currentMonth,
  categories,
  action,
}: {
  companyId: string;
  taxYear: number;
  currentMonth: number;
  categories: Category[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Extraction | null>(null);
  const [month, setMonth] = useState<number>(currentMonth);
  const [amount, setAmount] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setFile(null);
    setDraft(null);
    setError(null);
    setMonth(currentMonth);
    setAmount("");
    setCategory("");
    setNotes("");
  };

  const onUpload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/receipts/extract", {
        method: "POST",
        body: fd,
      });
      const json: Extraction & { error?: string } = await res.json();
      if (!res.ok) {
        setError(json.error || "Couldn't read this receipt.");
        return;
      }
      setDraft(json);
      // Pre-fill the editable form from the extraction.
      if (json.date) {
        const d = new Date(`${json.date}T00:00:00Z`);
        const m = d.getUTCMonth() + 1;
        if (m >= 1 && m <= currentMonth) setMonth(m);
      }
      if (json.total_cents && json.total_cents > 0) {
        setAmount((json.total_cents / 100).toFixed(2));
      }
      if (json.suggested_category) {
        const exists = categories.some((c) => c.code === json.suggested_category);
        if (exists) setCategory(json.suggested_category);
      }
      const noteParts = [json.vendor, json.description].filter(
        (s): s is string => !!s && s.length > 0,
      );
      if (noteParts.length > 0) setNotes(noteParts.join(" — "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const onCommit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData(e.currentTarget);
      await action(fd);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the expense.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {!draft ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft leading-relaxed">
            Drop a receipt photo or PDF. Bella reads the vendor, date, total,
            and a likely category. You confirm before it lands.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
              className="text-sm"
            />
            <button
              type="button"
              onClick={onUpload}
              disabled={!file || busy}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Reading…" : "Read receipt"}
            </button>
          </div>
          {error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : null}
        </div>
      ) : (
        <form onSubmit={onCommit} className="grid gap-3">
          <input type="hidden" name="company_id" value={companyId} />
          <input type="hidden" name="tax_year" value={taxYear} />
          <input type="hidden" name="recurrence" value="one_off" />

          <div className="rounded-lg border border-forest-100 bg-cream/40 p-3 text-xs text-ink-soft">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
                Bella read
              </span>
              <span className="text-forest-900 font-medium">
                {draft.vendor ?? "Unknown vendor"}
              </span>
              {draft.date ? (
                <>
                  <span className="text-gold-700">·</span>
                  <span>{draft.date}</span>
                </>
              ) : null}
              {draft.payment_method ? (
                <>
                  <span className="text-gold-700">·</span>
                  <span>{draft.payment_method}</span>
                </>
              ) : null}
              <span className="ml-auto text-[11px] text-ink-muted">
                {(draft.confidence * 100).toFixed(0)}% confident
              </span>
            </div>
            {draft.notes ? (
              <p className="mt-2 text-[11px] text-ink-muted">{draft.notes}</p>
            ) : null}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">Month</span>
              <select
                name="month"
                className="input"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MONTH_LABELS.slice(0, currentMonth).map((m, i) => (
                  <option key={i} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">Category</span>
              <select
                name="category_code"
                required
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="" disabled>
                  Select category
                </option>
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                    {c.is_meal ? " (50% deductible)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Amount (USD)
            </span>
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              required
              placeholder="$0.00"
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">Notes</span>
            <input
              name="notes"
              type="text"
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          {error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : null}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="submit"
              disabled={submitting || !category || !amount}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving…" : "Save expense"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-sm text-ink-soft hover:text-forest-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
