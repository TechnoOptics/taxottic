"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DOC_TYPE_LABELS,
  type PriorDocType,
} from "@/lib/ocr/extract-tax-doc";
import { PdfPasswordPrompt } from "./PdfPasswordPrompt";

type Props = {
  // Optional company to bind business-scoped docs to (Schedule C,
  // 1099-NEC, 1099-K). Null = personal docs only (W-2, 1099-INT etc.)
  companyId: string | null;
  // The prior year we're collecting docs for. Defaults to last year.
  defaultTaxYear?: number;
  // Where to send the user once they're done (after Apply). If absent,
  // calls router.refresh() instead so the same page re-renders.
  doneRedirect?: string;
};

type ForPerson = "self" | "spouse";

type ExtractedFile = {
  fileName: string;
  status: "uploading" | "extracted" | "error";
  forPerson: ForPerson;
  // Server response on success
  serverId?: string;
  docType?: PriorDocType;
  taxYear?: number | null;
  fields?: Record<string, number | string | null>;
  payerOrEmployer?: string | null;
  confidence?: number;
  notes?: string | null;
  error?: string;
};

/**
 * Drag-drop multi-file uploader for prior-year tax documents. Users
 * drop a stack of W-2s, 1099s, and Schedule C; we OCR each one,
 * classify it, and show what we found. They click "Apply" and we
 * pre-populate their tax_profile + monthly_income/expenses baselines
 * so the forecast starts at a realistic number instead of zero.
 *
 * Design choices:
 *   - One Anthropic call per file (extracts + classifies in one shot),
 *     so cost = $0.01-0.02 per doc and latency stays under 5s.
 *   - We DO persist each extraction to prior_year_documents so the
 *     user can come back and re-apply later (e.g. if they meant to
 *     attach to a different company).
 *   - The file bytes themselves never hit storage. The extracted
 *     numbers are the only thing persisted.
 */
export function PriorYearUploader({
  companyId,
  defaultTaxYear,
  doneRedirect,
}: Props) {
  const router = useRouter();
  const [taxYear, setTaxYear] = useState<number>(
    defaultTaxYear ?? new Date().getUTCFullYear() - 1,
  );
  const [files, setFiles] = useState<ExtractedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  // Default for the next batch of uploads. Each uploaded file is also
  // re-taggable individually after extraction lands.
  const [defaultPerson, setDefaultPerson] = useState<ForPerson>("self");
  // Password popup state. We park each locked PDF in a queue so a
  // multi-file drop with several locked PDFs prompts in turn.
  const [passwordQueue, setPasswordQueue] = useState<
    Array<{ file: File; forPerson: ForPerson }>
  >([]);
  const [wrongAttempt, setWrongAttempt] = useState(false);

  const uploadOne = useCallback(
    async (file: File, forPerson: ForPerson, password?: string) => {
      const fd = new FormData();
      fd.append("file", file);
      if (companyId) fd.append("companyId", companyId);
      fd.append("taxYear", String(taxYear));
      fd.append("forPerson", forPerson);
      if (password) fd.append("password", password);
      const res = await fetch("/api/prior-year/extract", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      return { res, data } as const;
    },
    [companyId, taxYear],
  );

  const applyResponse = useCallback(
    (file: File, ok: boolean, data: Record<string, unknown>) => {
      setFiles((prev) =>
        prev.map((row) =>
          row.fileName === file.name && row.status === "uploading"
            ? ok
              ? {
                  ...row,
                  status: "extracted" as const,
                  serverId: data.id as string,
                  docType: data.doc_type as PriorDocType,
                  taxYear: data.tax_year as number | null,
                  fields: data.fields as Record<string, number | string | null>,
                  payerOrEmployer: data.payer_or_employer as string | null,
                  confidence: data.confidence as number,
                  notes: data.notes as string | null,
                }
              : {
                  ...row,
                  status: "error" as const,
                  error: (data?.error as string) ?? "Upload failed",
                }
            : row,
        ),
      );
    },
    [],
  );

  const onFiles = useCallback(
    async (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      // Pre-create rows so the UI shows progress per file. Each row
      // remembers the person attribution chosen at drop time; the row
      // can be re-tagged after extraction lands.
      const rowsToAdd = list.map((f) => ({
        fileName: f.name,
        status: "uploading" as const,
        forPerson: defaultPerson,
      }));
      setFiles((prev) => [...prev, ...rowsToAdd]);
      // Sequentially upload (Anthropic rate limits + we want a tight
      // user experience showing each result land).
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const forPerson = defaultPerson;
        try {
          const { res, data } = await uploadOne(file, forPerson);
          if (res.status === 422 && data?.error === "pdf_password_required") {
            // Park the file in the password queue; it'll resolve when
            // the user types the password and submits the popup.
            setPasswordQueue((q) => [...q, { file, forPerson }]);
            continue;
          }
          applyResponse(file, res.ok, data);
        } catch (err) {
          setFiles((prev) =>
            prev.map((row) =>
              row.fileName === file.name && row.status === "uploading"
                ? {
                    fileName: file.name,
                    status: "error" as const,
                    forPerson: row.forPerson,
                    error: err instanceof Error ? err.message : "Network error",
                  }
                : row,
            ),
          );
        }
      }
    },
    [uploadOne, applyResponse, defaultPerson],
  );

  async function submitWithPassword(password: string) {
    const head = passwordQueue[0];
    if (!head) return;
    const { res, data } = await uploadOne(head.file, head.forPerson, password);
    if (res.status === 422 && data?.error === "pdf_password_required") {
      setWrongAttempt(true);
      return;
    }
    applyResponse(head.file, res.ok, data);
    setPasswordQueue((q) => q.slice(1));
    setWrongAttempt(false);
  }

  function cancelPasswordPrompt() {
    const head = passwordQueue[0];
    if (head) {
      applyResponse(head.file, false, { error: "Password not provided" });
    }
    setPasswordQueue((q) => q.slice(1));
    setWrongAttempt(false);
  }

  // Re-tag a single uploaded row. Updates both the local list (UI) and
  // patches the server row so the apply step picks up the new owner.
  async function changeRowPerson(row: ExtractedFile, next: ForPerson) {
    if (!row.serverId || row.forPerson === next) return;
    setFiles((prev) =>
      prev.map((r) => (r.fileName === row.fileName ? { ...r, forPerson: next } : r)),
    );
    try {
      await fetch(`/api/prior-year/${row.serverId}/owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forPerson: next }),
      });
    } catch {
      // Best-effort; the local UI already reflects the new tag and
      // the apply step reads the latest server value, so a transient
      // network blip just delays propagation by one apply click.
    }
  }

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
    },
    [onFiles],
  );

  async function applyAll() {
    setApplying(true);
    setApplyError(null);
    setApplyResult(null);
    try {
      const res = await fetch("/api/prior-year/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxYear, companyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setApplyError(data?.error ?? "Apply failed");
      } else {
        setApplyResult(
          `Applied ${data.applied} document${data.applied === 1 ? "" : "s"}` +
            (data.monthly_rows_created
              ? `, created ${data.monthly_rows_created} monthly baseline rows`
              : "") +
            (data.w2_wages_carried_cents
              ? `, carried ${formatUsd(data.w2_wages_carried_cents)} in W-2 wages forward`
              : "") +
            ".",
        );
        if (doneRedirect) {
          setTimeout(() => router.push(doneRedirect), 800);
        } else {
          router.refresh();
        }
      }
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Network error");
    } finally {
      setApplying(false);
    }
  }

  const extracted = files.filter((f) => f.status === "extracted");
  const hasUploading = files.some((f) => f.status === "uploading");

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm text-forest-800">
          Tax year:&nbsp;
          <select
            value={taxYear}
            onChange={(e) => setTaxYear(parseInt(e.target.value, 10))}
            className="input h-9 w-28"
          >
            {YEAR_CHOICES.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-forest-800">
          For:&nbsp;
          <select
            value={defaultPerson}
            onChange={(e) => setDefaultPerson(e.target.value as ForPerson)}
            className="input h-9 w-28"
            aria-label="Whose document is being uploaded"
          >
            <option value="self">You</option>
            <option value="spouse">Spouse</option>
          </select>
        </label>
        <span className="text-xs text-ink-muted">
          Drop W-2s, 1099s, Schedule C, or your full Form 1040. You can re-tag
          each file after upload.
        </span>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={
          "block rounded-xl border-2 border-dashed cursor-pointer text-center px-6 py-10 transition-colors " +
          (dragOver
            ? "border-gold-500 bg-gold-100/40"
            : "border-forest-200 bg-cream/50 hover:bg-cream/80")
        }
      >
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files);
            // reset value so re-selecting the same file works
            e.target.value = "";
          }}
        />
        <div className="display text-base text-forest-900">
          Drop files here, or click to browse
        </div>
        <div className="mt-1 text-xs text-ink-muted">
          PNG, JPG, WebP or PDF. 8 MB max per file. Multiple at once is fine.
        </div>
      </label>

      {files.length > 0 ? (
        <ul className="grid gap-2">
          {files.map((f, i) => (
            <li
              key={i}
              className="rounded-lg border border-forest-100 bg-white px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-forest-900 truncate">
                    {f.fileName}
                  </div>
                  {f.status === "uploading" ? (
                    <div className="text-xs text-ink-muted mt-0.5">
                      Reading...
                    </div>
                  ) : f.status === "error" ? (
                    <div className="text-xs text-red-700 mt-0.5">
                      {f.error}
                    </div>
                  ) : (
                    <>
                      <div className="text-xs text-forest-700 mt-0.5">
                        {f.docType ? DOC_TYPE_LABELS[f.docType] : "Unknown"}
                        {f.taxYear ? ` - tax year ${f.taxYear}` : ""}
                        {f.payerOrEmployer ? ` - ${f.payerOrEmployer}` : ""}
                      </div>
                      <FieldsPreview
                        docType={f.docType ?? "unknown"}
                        fields={f.fields ?? {}}
                      />
                      {f.notes ? (
                        <p className="mt-1.5 text-[11px] italic text-ink-muted">
                          {f.notes}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {f.status === "extracted" ? (
                    <select
                      value={f.forPerson}
                      onChange={(e) =>
                        changeRowPerson(f, e.target.value as ForPerson)
                      }
                      aria-label="Whose document"
                      className="input h-8 text-xs w-24"
                    >
                      <option value="self">You</option>
                      <option value="spouse">Spouse</option>
                    </select>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider text-ink-muted">
                      For: {f.forPerson === "spouse" ? "Spouse" : "You"}
                    </span>
                  )}
                  {f.status === "extracted" && f.confidence != null ? (
                    <ConfidencePill value={f.confidence} />
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {passwordQueue.length > 0 ? (
        <PdfPasswordPrompt
          fileName={passwordQueue[0].file.name}
          wrongAttempt={wrongAttempt}
          onSubmit={submitWithPassword}
          onCancel={cancelPasswordPrompt}
        />
      ) : null}

      {extracted.length > 0 ? (
        <div className="flex items-center gap-3 flex-wrap pt-2">
          <button
            type="button"
            onClick={applyAll}
            disabled={applying || hasUploading}
            className="btn-primary text-sm"
          >
            {applying
              ? "Applying..."
              : `Apply ${extracted.length} document${extracted.length === 1 ? "" : "s"}`}
          </button>
          {applyResult ? (
            <span className="text-xs text-forest-700">{applyResult}</span>
          ) : null}
          {applyError ? (
            <span className="text-xs text-red-700">{applyError}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const YEAR_CHOICES = (() => {
  const now = new Date().getUTCFullYear();
  return [now - 1, now - 2, now - 3, now - 4];
})();

function ConfidencePill({ value }: { value: number }) {
  const tone =
    value >= 0.85
      ? "bg-emerald-100 text-emerald-900"
      : value >= 0.6
        ? "bg-gold-100 text-gold-700"
        : "bg-red-100 text-red-700";
  return (
    <span
      className={`text-[10px] uppercase tracking-[0.15em] rounded-full px-2 py-0.5 ${tone}`}
    >
      {Math.round(value * 100)}% confident
    </span>
  );
}

function FieldsPreview({
  docType,
  fields,
}: {
  docType: PriorDocType;
  fields: Record<string, number | string | null>;
}) {
  // Show 1-3 of the most important fields per doc type.
  const KEYS_BY_TYPE: Partial<Record<PriorDocType, string[]>> = {
    w2: ["wages_cents", "federal_withheld_cents", "state_wages_cents"],
    "1099_nec": ["nonemployee_comp_cents", "federal_withheld_cents"],
    "1099_misc": ["rents_cents", "royalties_cents", "other_income_cents"],
    "1099_k": ["gross_payments_cents", "federal_withheld_cents"],
    "1099_div": ["ordinary_dividends_cents", "qualified_dividends_cents"],
    "1099_int": ["interest_income_cents", "federal_withheld_cents"],
    "1099_r": ["gross_distribution_cents", "taxable_amount_cents"],
    "1099_g": ["unemployment_comp_cents", "state_local_refund_cents"],
    schedule_c: [
      "gross_receipts_cents",
      "total_expenses_cents",
      "net_profit_cents",
    ],
    form_1040: ["total_income_cents", "agi_cents", "total_tax_cents"],
  };
  const keys = KEYS_BY_TYPE[docType] ?? [];
  if (!keys.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft">
      {keys.map((k) => {
        const v = fields[k];
        const cents = typeof v === "number" ? v : null;
        if (cents === null || cents === 0) return null;
        return (
          <span key={k}>
            <span className="text-ink-muted">
              {k
                .replace(/_cents$/, "")
                .replace(/_/g, " ")}:
            </span>{" "}
            <span className="font-medium text-forest-900 tabular-nums">
              {formatUsd(cents)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function formatUsd(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
