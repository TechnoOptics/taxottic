"use client";

import { useEffect, useRef, useState } from "react";
import { captureReceiptPhoto } from "@/lib/capacitor/camera-capture";

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
  // Signed proof (from /api/receipts/extract) that this scan really ran on the
  // server, so the committed expense can satisfy the manager receipt threshold
  // without a forgeable flag (item 10 hardening).
  const [receiptToken, setReceiptToken] = useState<{
    token: string;
    exp: number;
  } | null>(null);
  const webCamInputRef = useRef<HTMLInputElement | null>(null);

  // Receipt viewer: a live preview of the uploaded file so the user can
  // eyeball the actual receipt next to Bella's extracted numbers before
  // committing. Images render inline (click to enlarge); PDFs embed.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"image" | "pdf" | null>(null);
  const [zoom, setZoom] = useState(false);

  // Revoke the previous object URL whenever the preview changes / on unmount
  // so we never leak blob URLs as the user swaps receipts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Single entry point for "a file was chosen", sets the file AND builds its
  // viewer preview, so the two never drift. Everything (camera, web capture,
  // file picker) routes through here.
  const attach = (f: File | null) => {
    setError(null);
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
    setPreviewKind(f ? (f.type === "application/pdf" ? "pdf" : "image") : null);
  };

  const reset = () => {
    attach(null);
    setDraft(null);
    setMonth(currentMonth);
    setAmount("");
    setCategory("");
    setNotes("");
    setZoom(false);
    setReceiptToken(null);
  };

  const onUpload = async (explicitFile?: File) => {
    const f = explicitFile ?? file;
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch("/api/receipts/extract", {
        method: "POST",
        body: fd,
      });
      const json: Extraction & {
        error?: string;
        receipt_token?: string;
        receipt_token_exp?: number;
      } = await res.json();
      if (!res.ok) {
        setError(json.error || "Couldn't read this receipt.");
        return;
      }
      setDraft(json);
      if (json.receipt_token && typeof json.receipt_token_exp === "number") {
        setReceiptToken({
          token: json.receipt_token,
          exp: json.receipt_token_exp,
        });
      }
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
      if (noteParts.length > 0) setNotes(noteParts.join(", "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const onTakePhoto = async () => {
    setError(null);
    const r = await captureReceiptPhoto();
    if (r.kind === "file") {
      attach(r.file);
      await onUpload(r.file); // native capture → read immediately
    } else if (r.kind === "unavailable") {
      // Web (incl. mobile browsers): the capture-hinted input opens the
      // camera on a phone and a file picker on desktop.
      webCamInputRef.current?.click();
    } else if (r.kind === "error") {
      setError(r.message);
    }
    // "cancelled" → user backed out of the native camera; do nothing.
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
            Snap a photo of a receipt or drop a photo/PDF. Bella reads the
            vendor, date, total, and a likely category. You confirm before
            it lands.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onTakePhoto}
              disabled={busy}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Reading…" : "Take a photo"}
            </button>
            {/* Hidden camera-hinted input: the web fallback for phones
               (opens the camera) and desktop (opens a file picker). */}
            <input
              ref={webCamInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) {
                  attach(f);
                  void onUpload(f);
                }
              }}
            />
            <span className="text-xs text-ink-muted">or</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => attach(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <button
              type="button"
              onClick={() => onUpload()}
              disabled={!file || busy}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Reading…" : "Read receipt"}
            </button>
          </div>
          {error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : null}
          {previewUrl ? (
            <ReceiptPreview
              url={previewUrl}
              kind={previewKind}
              name={file?.name ?? "receipt"}
              onZoom={() => setZoom(true)}
            />
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          {previewUrl ? (
            <ReceiptPreview
              url={previewUrl}
              kind={previewKind}
              name={file?.name ?? "receipt"}
              onZoom={() => setZoom(true)}
            />
          ) : null}
          <form onSubmit={onCommit} className="grid gap-3">
          <input type="hidden" name="company_id" value={companyId} />
          <input type="hidden" name="tax_year" value={taxYear} />
          <input type="hidden" name="recurrence" value="one_off" />
          {/* Item 10: the signed token proves this scan really ran on the
             server, so addExpense can satisfy the manager's receipt threshold
             without trusting a forgeable flag. */}
          {receiptToken ? (
            <>
              <input
                type="hidden"
                name="receipt_token"
                value={receiptToken.token}
              />
              <input
                type="hidden"
                name="receipt_token_exp"
                value={receiptToken.exp}
              />
            </>
          ) : null}

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
        </div>
      )}

      {/* Full-screen lightbox for image receipts, tap anywhere to close. */}
      {zoom && previewUrl && previewKind === "image" ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-forest-950/80 p-4"
          onClick={() => setZoom(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Receipt full size"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Receipt full size"
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setZoom(false)}
            aria-label="Close"
            className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/90 text-lg text-forest-900 hover:bg-white"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Receipt viewer panel: shows the uploaded image (click to enlarge) or an
// embedded PDF, framed to match the app's cards. Pure presentational, the
// object URL + zoom state live in ReceiptUploader.
function ReceiptPreview({
  url,
  kind,
  name,
  onZoom,
}: {
  url: string;
  kind: "image" | "pdf" | null;
  name: string;
  onZoom: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-forest-100 bg-cream/40">
      <div className="flex items-center justify-between gap-2 border-b border-forest-100 px-3 py-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
          Receipt
        </span>
        <span className="truncate text-[11px] text-ink-muted" title={name}>
          {name}
        </span>
      </div>
      {kind === "image" ? (
        <button
          type="button"
          onClick={onZoom}
          title="Click to enlarge"
          className="group block w-full cursor-zoom-in bg-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Uploaded receipt"
            className="mx-auto max-h-[420px] w-full object-contain transition-transform duration-200 group-hover:scale-[1.01]"
          />
        </button>
      ) : (
        <object
          data={url}
          type="application/pdf"
          className="h-[420px] w-full bg-white"
          aria-label="Uploaded receipt PDF"
        >
          <div className="p-4 text-xs text-ink-soft">
            PDF preview isn&apos;t supported here.{" "}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-forest-800"
            >
              Open the PDF
            </a>
          </div>
        </object>
      )}
    </div>
  );
}
