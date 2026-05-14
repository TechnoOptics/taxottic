"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";

// Public firm-account request action. No auth required — the
// firm_access_requests table has an `anon insert` RLS policy. We
// still validate aggressively here so the table doesn't fill up
// with junk: rate-limit by email, length-check each field, and
// require the four mandatory columns.
//
// On success: redirect to /firms/request-account?ok=1 which renders
// a confirmation panel.

const MAX_FIELD_LENGTH = 1000;

function trimmed(value: FormDataEntryValue | null, max = MAX_FIELD_LENGTH) {
  const s = (typeof value === "string" ? value : "").trim();
  return s.slice(0, max);
}

export async function submitFirmAccessRequest(formData: FormData) {
  const admin = createServiceClient();

  const firmName = trimmed(formData.get("firm_name"), 120);
  const contactFullName = trimmed(formData.get("contact_full_name"), 120);
  const contactEmail = trimmed(formData.get("contact_email"), 200).toLowerCase();
  const contactPhone = trimmed(formData.get("contact_phone"), 40) || null;
  const firmSize = trimmed(formData.get("firm_size"), 40) || null;
  const message = trimmed(formData.get("message")) || null;
  const source = trimmed(formData.get("source"), 80) || "request-account";

  if (!firmName) throw new Error("Firm name is required.");
  if (!contactFullName) throw new Error("Contact name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    throw new Error("Provide a valid contact email.");
  }

  // Soft rate-limit: if this email already has a pending request from
  // the last 24 hours, treat it as success without inserting a dupe.
  // The redirect at the end lands on the same confirmation panel; a
  // human in the queue eyeballs the request and either approves or
  // rejects.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: existing } = await admin
    .from("firm_access_requests")
    .select("id, created_at")
    .ilike("contact_email", contactEmail)
    .eq("status", "pending")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    const { error } = await admin.from("firm_access_requests").insert({
      firm_name: firmName,
      contact_full_name: contactFullName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      firm_size: firmSize,
      message,
      source,
    });
    if (error) throw new Error(error.message);
  }

  redirect("/firms/request-account?ok=1");
}
