"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  companyId: string;
  companyPublicId: string;
  companyName: string;
  initialLogoUrl: string | null;
  isManager: boolean;
  setLogoAction: (formData: FormData) => Promise<void>;
  clearLogoAction: (formData: FormData) => Promise<void>;
};

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

/**
 * Logo upload + preview + replace + remove. The upload itself runs
 * client-side via supabase-js so we don't have to ferry a 2 MB binary
 * through a Next.js server action. Storage RLS gates the write to
 * managers of this company; the followup server action validates the
 * URL is on our Supabase host and writes companies.logo_url.
 *
 * Path convention: <company_public_id>/logo-<timestamp>.<ext>
 *   - The leading folder matches what the storage RLS policy reads via
 *     storage.foldername(name)[1] to look up the company.
 *   - The timestamp suffix sidesteps browser/CDN caching when the
 *     manager replaces the file.
 */
export function CompanyLogoUploader({
  companyId,
  companyPublicId,
  companyName,
  initialLogoUrl,
  isManager,
  setLogoAction,
  clearLogoAction,
}: Props) {
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "saving" | "saved" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(file: File) {
    setError(null);

    if (!ACCEPTED_TYPES.has(file.type)) {
      setError(
        "Please upload a PNG, JPG, WebP, or SVG. Other formats aren't supported.",
      );
      setStatus("error");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The cap is 2 MB - please compress it and try again.`,
      );
      setStatus("error");
      return;
    }

    const supabase = createClient();
    const ext =
      ({
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/svg+xml": "svg",
      } as const)[file.type] ?? "bin";
    const path = `${companyPublicId}/logo-${Date.now()}.${ext}`;

    setStatus("uploading");
    const { error: uploadError } = await supabase.storage
      .from("company-logos")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

    if (uploadError) {
      // RLS-denied uploads come back as "new row violates row-level
      // security policy". Translate to plain English.
      const msg = /row-level security/i.test(uploadError.message)
        ? "Only the company manager can change the logo."
        : uploadError.message;
      setError(msg);
      setStatus("error");
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from("company-logos")
      .getPublicUrl(path);
    const publicUrl = publicUrlData.publicUrl;

    setStatus("saving");
    try {
      const fd = new FormData();
      fd.set("company_id", companyId);
      fd.set("logo_url", publicUrl);
      await setLogoAction(fd);
      setLogoUrl(publicUrl);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStatus("error");
    }
  }

  async function handleRemove() {
    if (status === "uploading" || status === "saving") return;
    setError(null);
    setStatus("saving");
    try {
      const fd = new FormData();
      fd.set("company_id", companyId);
      await clearLogoAction(fd);
      setLogoUrl(null);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
      setStatus("error");
    }
  }

  const busy = status === "uploading" || status === "saving";
  const monogram = (companyName.trim().charAt(0) || "T").toUpperCase();

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-4">
        {/* Preview tile - keeps a fixed square so the rest of the
            form layout doesn't jump around when the logo changes. */}
        <div
          className="relative size-20 sm:size-24 rounded-xl border border-forest-100 bg-cream/60 grid place-items-center overflow-hidden shrink-0"
          aria-label="Logo preview"
        >
          {logoUrl ? (
            // Plain <img> on purpose: this is a Supabase Storage URL
            // that's already cached + sized appropriately, and we want
            // to dodge next/image's domain config + RSC re-renders for
            // a feature this small.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`${companyName} logo`}
              className="max-w-full max-h-full object-contain p-2"
            />
          ) : (
            <div
              className="size-full grid place-items-center display text-3xl text-forest-800"
              aria-hidden="true"
            >
              {monogram}
            </div>
          )}
        </div>

        <div className="grid gap-2 flex-1 min-w-0">
          <div>
            <div className="text-sm font-medium text-forest-800">
              Company logo
            </div>
            <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              Shows on this page, the dashboard, and the year-end report
              you hand to your CPA. PNG, JPG, WebP, or SVG up to 2 MB.
            </div>
          </div>
          {isManager ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFiles(f);
                  // Reset so the same file can be picked again later.
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="btn-primary text-sm"
              >
                {status === "uploading"
                  ? "Uploading..."
                  : status === "saving"
                    ? "Saving..."
                    : logoUrl
                      ? "Replace logo"
                      : "Upload logo"}
              </button>
              {logoUrl ? (
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={busy}
                  className="btn-ghost text-sm"
                >
                  Remove
                </button>
              ) : null}
              {status === "saved" ? (
                <span
                  role="status"
                  className="text-xs text-emerald-800 inline-flex items-center gap-1"
                >
                  Saved
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              Only managers can change the logo.
            </p>
          )}
          {error ? (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
