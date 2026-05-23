"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Multi-file CSV upload with drag-and-drop.
 *
 * Replaces the single-file `<form action={uploadCsv}>` on the import
 * page. Users can drop several CSVs at once (or pick them via the
 * file dialog); we iterate the chosen files through the batch action
 * one at a time, surfacing per-file status as we go.
 *
 * We deliberately don't parallelise the uploads. The server action
 * already runs the Bella categorize pass on each import, so firing
 * five uploads in parallel would five-up the Anthropic load and stack
 * five categorize runs. Sequential keeps the UX legible and the
 * spend predictable.
 *
 * The `action` prop must be the non-redirecting batch flavor
 * (`uploadCsvBatch` in app/c/[publicId]/import/actions.ts). The
 * dropzone navigates the user manually after the queue completes — to
 * the LAST successful import-review page, or back to the import page
 * with the error inline if anything failed.
 */
type BatchResult =
  | { ok: true; importId: string; publicId: string }
  | { ok: false; error: string; publicId: string };

type Props = {
  /** Hidden field value embedded into every upload. */
  companyId: string;
  /** Non-redirecting batch action — returns a JSON-friendly result. */
  action: (formData: FormData) => Promise<BatchResult>;
};

type FileStatus =
  | { phase: "queued" }
  | { phase: "uploading" }
  | { phase: "done"; importId: string }
  | { phase: "error"; message: string };

export function CsvDropZone({ companyId, action }: Props) {
  const router = useRouter();
  const [accountType, setAccountType] = useState("business_checking");
  const [files, setFiles] = useState<File[]>([]);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);
  const [isPending, startTransition] = useTransition();
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming).filter((f) =>
      f.name.toLowerCase().endsWith(".csv") || f.type === "text/csv",
    );
    if (list.length === 0) return;
    setFiles((prev) => [...prev, ...list]);
    setStatuses((prev) => [
      ...prev,
      ...list.map(() => ({ phase: "queued" }) as FileStatus),
    ]);
  }

  function removeAt(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setStatuses((prev) => prev.filter((_, i) => i !== idx));
  }

  async function uploadAll() {
    if (files.length === 0) return;
    startTransition(async () => {
      let lastImportId: string | null = null;
      let lastPublicId = "";
      let stopOnError: { i: number; msg: string; publicId: string } | null =
        null;

      // Iterate sequentially. Each call returns a result (no
      // redirect), so the dropzone stays mounted across the whole
      // queue and we can show per-row status. On first error we stop
      // and navigate to the import page with the message.
      for (let i = 0; i < files.length; i++) {
        setStatuses((prev) => {
          const next = [...prev];
          next[i] = { phase: "uploading" };
          return next;
        });
        const fd = new FormData();
        fd.set("company_id", companyId);
        fd.set("account_type", accountType);
        fd.set("file", files[i]);
        const result = await action(fd);
        if (result.ok) {
          lastImportId = result.importId;
          lastPublicId = result.publicId;
          setStatuses((prev) => {
            const next = [...prev];
            next[i] = { phase: "done", importId: result.importId };
            return next;
          });
        } else {
          stopOnError = {
            i,
            msg: result.error,
            publicId: result.publicId,
          };
          setStatuses((prev) => {
            const next = [...prev];
            next[i] = { phase: "error", message: result.error };
            return next;
          });
          break;
        }
      }

      // After the queue: navigate. Errors get priority — if any file
      // failed, land on the import page with the inline banner. If
      // every file succeeded, send the user to the last import's
      // review page (a common pattern: upload 3 months of statements,
      // jump straight into the most-recent one for review).
      if (stopOnError) {
        router.push(
          `/c/${stopOnError.publicId}/import?error=${encodeURIComponent(
            stopOnError.msg,
          )}`,
        );
      } else if (lastImportId && lastPublicId) {
        router.push(`/c/${lastPublicId}/import/${lastImportId}`);
      }
    });
  }

  return (
    <div className="grid gap-4">
      <label className="grid gap-2">
        <span className="text-sm font-medium text-forest-800">
          What kind of account is this?{" "}
          <span className="text-rose-700">*</span>
        </span>
        <select
          name="account_type"
          required
          value={accountType}
          onChange={(e) => setAccountType(e.target.value)}
          className="input"
        >
          <option value="business_checking">
            Business checking — negative amounts are expenses
          </option>
          <option value="business_savings">
            Business savings — negative amounts are expenses
          </option>
          <option value="checking">
            Personal checking — negative amounts are expenses
          </option>
          <option value="savings">
            Personal savings — negative amounts are expenses
          </option>
          <option value="credit">
            Credit card — positive amounts are charges
          </option>
          <option value="other">Other</option>
        </select>
        {/* Be explicit about the credit-card sign convention because
            picking the wrong type silently inflates the deduction —
            checking-mode treats negatives as expenses, credit-mode
            treats positives as expenses. Got bit by this on the
            user's "activity (2).csv" upload May 23 2026 where a card
            statement was uploaded as "business_checking" and the
            $8,924 MOBILE PAYMENT - THANK YOU row would have applied
            as an expense. */}
        {accountType === "credit" ? (
          <span className="text-[11px] text-ink-muted leading-relaxed">
            <strong>Credit card:</strong> positive amounts are charges
            (real expenses). Negative amounts are refunds — held back
            for your review. &quot;Mobile payments&quot; / &quot;Payment - Thank
            you&quot; rows are your balance being paid from another
            account; we skip those automatically.
          </span>
        ) : (
          <span className="text-[11px] text-ink-muted leading-relaxed">
            <strong>Checking / savings:</strong> negative amounts are
            expenses (money out), positive amounts are income. If
            you&apos;re importing a credit-card statement, pick
            &quot;Credit card&quot; instead — the sign convention is
            inverted.
          </span>
        )}
      </label>

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          // Only clear when the drag leaves the actual zone, not when
          // moving over a child element. dataTransfer is null on
          // synthetic events from React but the relatedTarget check
          // is the standard guard.
          if (
            e.currentTarget.contains(
              e.relatedTarget as Node | null,
            )
          )
            return;
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={
          "rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors " +
          (isDragging
            ? "border-gold-500 bg-gold-50"
            : "border-forest-200 bg-cream/40 hover:border-forest-400")
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="display text-base text-forest-900">
          Drop CSVs here, or click to choose
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          You can pick multiple files. Each one becomes its own import.
        </p>
      </div>

      {files.length > 0 ? (
        <ul className="grid gap-1.5">
          {files.map((f, i) => {
            const s = statuses[i];
            return (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg border border-forest-100 bg-white/70 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-forest-900 truncate">
                    {f.name}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {(f.size / 1024).toFixed(1)} KB · {statusLabel(s)}
                  </div>
                </div>
                {s.phase === "queued" || s.phase === "error" ? (
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="text-xs text-ink-muted hover:text-red-700"
                    disabled={isPending}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={uploadAll}
        disabled={files.length === 0 || isPending}
        className="btn-primary w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending
          ? "Uploading..."
          : files.length > 1
            ? `Upload ${files.length} files`
            : "Upload and parse"}
      </button>
    </div>
  );
}

function statusLabel(s: FileStatus | undefined): string {
  if (!s) return "queued";
  switch (s.phase) {
    case "queued":
      return "queued";
    case "uploading":
      return "uploading…";
    case "done":
      return "done";
    case "error":
      return `error: ${s.message}`;
  }
}
