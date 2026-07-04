"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  userId: string;
  displayName: string;
  initialAvatarUrl: string | null;
  setAvatarAction: (formData: FormData) => Promise<void>;
  clearAvatarAction: (formData: FormData) => Promise<void>;
};

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Personal avatar upload + preview + replace + remove. Same shape as
 * CompanyLogoUploader (client-side supabase-js upload, then a server
 * action persists the resolved URL) but scoped to the caller's own
 * user id instead of a manager's company, every signed-in user can
 * manage their own avatar, no role gate needed.
 *
 * Path convention: <user_id>/avatar-<timestamp>.<ext>, the leading
 * folder is what the "avatars" bucket's storage RLS checks against
 * auth.uid() (see 20260702150900_avatars_storage.sql).
 */
export function AvatarUploader({
  userId,
  displayName,
  initialAvatarUrl,
  setAvatarAction,
  clearAvatarAction,
}: Props) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "saving" | "saved" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(file: File) {
    setError(null);

    if (!ACCEPTED_TYPES.has(file.type)) {
      setError("Please upload a PNG, JPG, or WebP image.");
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
      ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const)[
        file.type
      ] ?? "bin";
    const path = `${userId}/avatar-${Date.now()}.${ext}`;

    setStatus("uploading");
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

    if (uploadError) {
      setError(uploadError.message);
      setStatus("error");
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(path);
    const publicUrl = publicUrlData.publicUrl;

    setStatus("saving");
    try {
      const fd = new FormData();
      fd.set("avatar_url", publicUrl);
      await setAvatarAction(fd);
      setAvatarUrl(publicUrl);
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
      await clearAvatarAction(new FormData());
      setAvatarUrl(null);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
      setStatus("error");
    }
  }

  const busy = status === "uploading" || status === "saving";
  const initials =
    displayName
      .trim()
      .split(/\s+/)
      .map((p) => p.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <div className="flex items-center gap-4">
      <div
        className="relative size-16 sm:size-20 rounded-full border border-forest-100 bg-cream/60 grid place-items-center overflow-hidden shrink-0"
        aria-label="Avatar preview"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={`${displayName}'s avatar`}
            className="size-full object-cover"
          />
        ) : (
          <div
            className="size-full grid place-items-center display text-xl text-forest-800"
            aria-hidden="true"
          >
            {initials}
          </div>
        )}
      </div>

      <div className="grid gap-2 flex-1 min-w-0">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFiles(f);
            e.target.value = "";
          }}
        />
        <div className="flex items-center gap-2 flex-wrap">
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
                : avatarUrl
                  ? "Replace photo"
                  : "Upload photo"}
          </button>
          {avatarUrl ? (
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
        <p className="text-xs text-ink-muted">PNG, JPG, or WebP up to 2 MB.</p>
        {error ? (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
