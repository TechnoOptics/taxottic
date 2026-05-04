"use server";

import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";

const AUDIENCES = new Set(["firm", "individual", "small_business"]);
const CLIENT_BANDS = new Set([
  "1_solo",
  "2_10",
  "11_50",
  "51_200",
  "200_plus",
]);
const TIMINGS = new Set(["this_week", "next_week", "this_month", "exploring"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InquiryResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Insert a public inquiry from the /book form. No auth required.
 * Service-role insert bypasses RLS so we don't expose anonymous SELECT
 * on the table; the policy still allows anon INSERT for safety.
 */
export async function submitInquiry(formData: FormData): Promise<InquiryResult> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const workEmail = String(formData.get("work_email") ?? "").trim().toLowerCase();
  const firmName = String(formData.get("firm_name") ?? "").trim() || null;
  const roleTitle = String(formData.get("role_title") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const audienceRaw = String(formData.get("audience") ?? "").trim();
  const clientBandRaw = String(formData.get("client_count_band") ?? "").trim();
  const currentSoftware =
    String(formData.get("current_software") ?? "").trim() || null;
  const timingRaw = String(formData.get("preferred_timing") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const sourcePath = String(formData.get("source_path") ?? "").trim() || null;

  if (!fullName) return { ok: false, error: "Please tell us your name." };
  if (!EMAIL_RE.test(workEmail)) {
    return { ok: false, error: "That email looks off. Mind double-checking?" };
  }
  if (!AUDIENCES.has(audienceRaw)) {
    return { ok: false, error: "Pick which best describes you." };
  }

  const clientBand = CLIENT_BANDS.has(clientBandRaw) ? clientBandRaw : null;
  const timing = TIMINGS.has(timingRaw) ? timingRaw : null;

  const h = await headers();
  const userAgent = h.get("user-agent")?.slice(0, 500) ?? null;

  const admin = createServiceClient();
  const { error } = await admin.from("firm_inquiries").insert({
    full_name: fullName.slice(0, 200),
    work_email: workEmail.slice(0, 320),
    firm_name: firmName?.slice(0, 200) ?? null,
    role_title: roleTitle?.slice(0, 200) ?? null,
    phone: phone?.slice(0, 50) ?? null,
    audience: audienceRaw,
    client_count_band: clientBand,
    current_software: currentSoftware?.slice(0, 80) ?? null,
    preferred_timing: timing,
    notes: notes?.slice(0, 4000) ?? null,
    source_path: sourcePath?.slice(0, 200) ?? null,
    user_agent: userAgent,
  });

  if (error) {
    return {
      ok: false,
      error:
        "Something went wrong on our end. Please try again, or email hello@taxottic.com directly.",
    };
  }
  return { ok: true };
}
