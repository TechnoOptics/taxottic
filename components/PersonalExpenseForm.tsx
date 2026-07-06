"use client";

import { useRef, useState } from "react";
import { parseDollarsToCents } from "@/lib/tax/forecast";
import { PERSONAL_EXPENSE_CATEGORIES } from "@/lib/tax/personal-expense-categories";
import { captureReceiptPhoto } from "@/lib/capacitor/camera-capture";

// The subset of the /api/receipts/extract response we use to prefill.
type Extraction = {
  vendor: string | null;
  date: string | null;
  total_cents: number | null;
  description: string | null;
  error?: string;
};

/**
 * Add a personal (individual-side) deductible expense. Client component so we
 * can show the category hint as the user picks, live-validate the amount, and
 * offer receipt-scan autofill. Commits through the addPersonalExpense server
 * action passed in.
 *
 * Scan autofill reuses the same OCR pipeline as the business side
 * (/api/receipts/extract): snap or upload a receipt and Bella fills the
 * amount, date, and a vendor note. The deduction category is left for the user
 * to choose, because the OCR's suggested category is Schedule-C (business)
 * oriented and doesn't map onto the individual deduction buckets here.
 */
export function PersonalExpenseForm({
  action,
  defaultDate,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Today, as YYYY-MM-DD, computed on the server so SSR is stable. */
  defaultDate: string;
}) {
  const [category, setCategory] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [date, setDate] = useState<string>(defaultDate);
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const webCamInputRef = useRef<HTMLInputElement | null>(null);

  const hint = PERSONAL_EXPENSE_CATEGORIES.find((c) => c.code === category)?.hint;
  // Live-validate the amount with the SAME parser the server uses, so the user
  // gets inline guidance instead of a round-trip error on "12,50" or "$1 2".
  const amountInvalid = amount.trim() !== "" && parseDollarsToCents(amount) === null;

  const yearStart = `${defaultDate.slice(0, 4)}-01-01`;

  async function scan(file: File) {
    setScanning(true);
    setError(null);
    setScanNote(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/receipts/extract", {
        method: "POST",
        body: fd,
      });
      const json: Extraction = await res.json();
      if (!res.ok) {
        // Map the route's machine error codes to friendly copy.
        const friendly: Record<string, string> = {
          subscription_required:
            "Receipt scanning needs a paid plan. You can still add expenses by hand below.",
          insufficient_credits:
            "You're out of scan credits. Add expenses by hand below, or top up.",
          auth_required: "Please sign in again to scan receipts.",
        };
        setError(
          (json.error && friendly[json.error]) ||
            json.error ||
            "Couldn't read that receipt.",
        );
        return;
      }
      // Prefill what maps cleanly onto a personal deduction entry.
      if (json.total_cents && json.total_cents > 0) {
        setAmount((json.total_cents / 100).toFixed(2));
      }
      // Only accept a date inside the current tax year (the tracker + forecast
      // only read the current year, and the action rejects other years).
      if (json.date && json.date >= yearStart && json.date <= defaultDate) {
        setDate(json.date);
      }
      const noteParts = [json.vendor, json.description].filter(
        (s): s is string => !!s && s.length > 0,
      );
      if (noteParts.length > 0) setNotes(noteParts.join(", "));

      setScanNote(
        json.vendor
          ? `Read ${json.vendor}${json.date ? ` · ${json.date}` : ""}. Pick a deduction category to finish.`
          : "Receipt read. Check the amount and pick a category.",
      );
    } catch {
      setError("Couldn't reach the receipt reader. Try again.");
    } finally {
      setScanning(false);
    }
  }

  async function onScanClick() {
    setError(null);
    const r = await captureReceiptPhoto();
    if (r.kind === "file") {
      await scan(r.file);
    } else if (r.kind === "unavailable") {
      // Web (incl. mobile browsers): the capture-hinted input opens the camera
      // on a phone and a file picker on desktop.
      webCamInputRef.current?.click();
    } else if (r.kind === "error") {
      setError(r.message);
    }
    // "cancelled" → user backed out; do nothing.
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await action(new FormData(e.currentTarget));
      setCategory("");
      setAmount("");
      setDate(defaultDate);
      setNotes("");
      setScanNote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 grid sm:grid-cols-2 gap-3">
      {/* Receipt-scan autofill */}
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onScanClick}
          disabled={scanning}
          className="btn-ghost text-sm h-9 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scanning ? "Reading receipt..." : "Scan a receipt"}
        </button>
        <input
          ref={webCamInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void scan(f);
            e.target.value = "";
          }}
        />
        <span className="text-[11px] text-ink-muted">
          Snap a receipt and we fill the amount, date, and vendor.
        </span>
      </div>
      {scanNote ? (
        <p
          className="sm:col-span-2 -mt-1 rounded-lg border border-forest-100 bg-cream/40 px-3 py-2 text-[12px] text-forest-800"
          role="status"
        >
          {scanNote}
        </p>
      ) : null}

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">Category</span>
        <select
          name="category"
          required
          className="input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="" disabled>
            Select category
          </option>
          {PERSONAL_EXPENSE_CATEGORIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">Amount (USD)</span>
        <input
          name="amount"
          type="text"
          inputMode="decimal"
          required
          placeholder="$0.00"
          className="input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={amountInvalid || undefined}
        />
        {amountInvalid ? (
          <span className="text-[11px] text-red-700">
            Enter a dollar amount, like 42.50.
          </span>
        ) : null}
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">Date incurred</span>
        <input
          name="incurred_on"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          min={yearStart}
          max={defaultDate}
          className="input"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">Notes (optional)</span>
        <input
          name="notes"
          type="text"
          className="input"
          placeholder="e.g. Red Cross donation"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {hint ? (
        <p className="sm:col-span-2 -mt-1 text-[11px] text-ink-muted">{hint}</p>
      ) : null}
      {error ? (
        <p className="sm:col-span-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={saving || amountInvalid}
          className="btn-primary w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Add expense"}
        </button>
      </div>
    </form>
  );
}
