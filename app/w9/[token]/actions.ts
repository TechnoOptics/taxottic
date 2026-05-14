"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";

// Public W-9 submission action. Validates fields aggressively
// before calling the SECURITY DEFINER RPC. The RPC re-enforces
// token + expiry + status preconditions, so even a malicious
// client can't bypass.

const VALID_ENTITY_TYPES = new Set([
  "individual",
  "sole_prop",
  "c_corp",
  "s_corp",
  "partnership",
  "trust_estate",
  "llc_c_corp",
  "llc_s_corp",
  "llc_partnership",
  "llc_single_member",
  "other",
]);

const VALID_TIN_TYPES = new Set(["ssn", "ein"]);

export async function submitW9(formData: FormData) {
  const admin = createServiceClient();
  const h = await headers();
  const token = String(formData.get("token") ?? "");
  if (!token) throw new Error("Missing token.");

  const legalName = String(formData.get("legal_name") ?? "").trim();
  if (legalName.length < 1) throw new Error("Legal name is required.");

  const businessName = String(formData.get("business_name") ?? "").trim() || null;
  const entityRaw = String(formData.get("entity_type") ?? "");
  if (!VALID_ENTITY_TYPES.has(entityRaw)) {
    throw new Error("Select a federal tax classification.");
  }
  const llcTax = String(formData.get("llc_tax_classification") ?? "").trim();
  const otherClass =
    String(formData.get("other_classification") ?? "").trim() || null;
  const exemptPayee =
    String(formData.get("exempt_payee_code") ?? "").trim() || null;
  const exemptFatca =
    String(formData.get("exempt_fatca_code") ?? "").trim() || null;
  const addrLine1 =
    String(formData.get("address_line_1") ?? "").trim() || null;
  const addrLine2 =
    String(formData.get("address_line_2") ?? "").trim() || null;
  const addrCity = String(formData.get("address_city") ?? "").trim() || null;
  const addrRegion =
    String(formData.get("address_region") ?? "").trim().toUpperCase() || null;
  const addrPostal =
    String(formData.get("address_postal_code") ?? "").trim() || null;

  const tinTypeRaw = String(formData.get("tin_type") ?? "");
  if (!VALID_TIN_TYPES.has(tinTypeRaw)) {
    throw new Error("Choose SSN or EIN.");
  }
  const tinDigits = String(formData.get("tin_digits") ?? "").replace(/\D/g, "");
  if (tinDigits.length !== 9) {
    throw new Error("TIN must be 9 digits.");
  }
  const signature = String(formData.get("signature_full_name") ?? "").trim();
  if (signature.length < 2) {
    throw new Error("Type your full name to sign.");
  }

  // IP + UA for the audit record. `x-forwarded-for` chains list
  // hops; the first hop is the real client IP. Vercel sets the
  // header consistently.
  const ipHeader = h.get("x-forwarded-for") ?? "";
  const ip = ipHeader.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const ua = h.get("user-agent") ?? null;

  const { error } = await admin.rpc("submit_w9_form", {
    p_token: token,
    p_legal_name: legalName,
    p_business_name: businessName,
    p_entity_type: entityRaw,
    p_llc_tax_classification: llcTax || null,
    p_other_classification: otherClass,
    p_exempt_payee_code: exemptPayee,
    p_exempt_fatca_code: exemptFatca,
    p_address_line_1: addrLine1,
    p_address_line_2: addrLine2,
    p_address_city: addrCity,
    p_address_region: addrRegion,
    p_address_postal_code: addrPostal,
    p_tin_type: tinTypeRaw,
    p_tin_digits: tinDigits,
    p_signature_full_name: signature,
    p_signed_ip: ip,
    p_signed_ua: ua,
  });
  if (error) throw new Error(error.message);

  redirect(`/w9/${token}/thank-you`);
}
