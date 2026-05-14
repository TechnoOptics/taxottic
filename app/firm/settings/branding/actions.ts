"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";

export async function updateFirmBranding(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Firm name is required.");

  const legalName = String(formData.get("legal_name") ?? "").trim() || null;
  const accentRaw = String(formData.get("accent_color") ?? "").trim();
  // Validate hex color server-side so a bad value doesn't break
  // the email templates. Accept #RGB / #RRGGBB / rrggbb / rgb.
  const accentColor = /^#?[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(accentRaw)
    ? accentRaw.startsWith("#")
      ? accentRaw
      : `#${accentRaw}`
    : null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const website = String(formData.get("website") ?? "").trim() || null;
  const address_line_1 = String(formData.get("address_line_1") ?? "").trim() || null;
  const address_city = String(formData.get("address_city") ?? "").trim() || null;
  const address_region = String(formData.get("address_region") ?? "").trim() || null;
  const address_postal_code =
    String(formData.get("address_postal_code") ?? "").trim() || null;

  const patch: Record<string, unknown> = {
    name,
    legal_name: legalName,
    phone,
    email,
    website,
    address_line_1,
    address_city,
    address_region,
    address_postal_code,
  };
  if (accentColor) patch.accent_color = accentColor;

  const { error } = await admin
    .from("firms")
    .update(patch)
    .eq("id", ctx.firm.id);
  if (error) throw new Error(error.message);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.note_added",
    summary: "Firm branding updated.",
    payload: {
      fields_changed: Object.keys(patch),
    },
  });

  revalidatePath("/firm/settings/branding");
  revalidatePath("/firm/settings");
}

export async function uploadFirmLogo(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();

  const file = formData.get("logo") as unknown as File | null;
  if (!file || !(file as { size?: number }).size) {
    throw new Error("Choose a logo file.");
  }
  // 2MB cap matches the consumer company-logo flow.
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Logo must be 2MB or smaller.");
  }
  const allowed = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/svg+xml",
  ]);
  if (!allowed.has(file.type)) {
    throw new Error("Logo must be PNG, JPG, WebP, or SVG.");
  }

  const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `firms/${ctx.firm.id}/logo-${Date.now()}.${ext}`;
  // We store firm logos in the existing `firm-assets` bucket (same
  // public-readable pattern as company logos). Create the bucket
  // in the console if it doesn't exist yet; the runbook covers it.
  const { error: uploadErr } = await admin.storage
    .from("firm-assets")
    .upload(path, file, {
      contentType: file.type,
      upsert: true,
    });
  if (uploadErr) {
    // Don't block the firm — the URL update still works once the
    // bucket is created.
    throw new Error(`Logo upload failed: ${uploadErr.message}`);
  }
  const { data: publicUrl } = admin.storage
    .from("firm-assets")
    .getPublicUrl(path);

  await admin
    .from("firms")
    .update({ logo_url: publicUrl.publicUrl })
    .eq("id", ctx.firm.id);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.note_added",
    summary: "Firm logo updated.",
    payload: { logo_url: publicUrl.publicUrl },
  });

  revalidatePath("/firm/settings/branding");
}
