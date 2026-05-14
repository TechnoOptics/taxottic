"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";
import { generateEngagementLetterHTML } from "@/lib/firm/documents/generate";
import {
  loadScheduleCData,
  renderScheduleCHTML,
} from "@/lib/firm/documents/generate-schedule-c";
import {
  loadK1Data,
  renderK1HTML,
  type K1Variant,
} from "@/lib/firm/documents/generate-k1";
import {
  loadNECRecipients,
  loadMISCRecipients,
  render1099HTML,
} from "@/lib/firm/documents/generate-1099";

// Server actions for /firm/clients/{engagementId}/documents.
//
// Phase 5 v1 covers:
//   - generateEngagementLetter: builds the HTML, uploads to
//     Supabase Storage, creates a firm_documents row,
//     transitions to ready_for_review.
//   - markDocumentReady: flips status draft → ready_for_review.
//   - archiveDocument: status → archived (kept for audit; hidden
//     from default lists).

const STORAGE_BUCKET = "firm-documents";

export async function generateEngagementLetter(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!engagementId) throw new Error("Missing engagement.");

  // Load engagement + company + firm address for the letter body.
  const { data: eng } = await admin
    .from("firm_engagements")
    .select(
      "id, firm_id, company_id, tax_year, kind, scope_summary, company:companies!inner(id, name, legal_name, address_line_1, address_city, address_region, address_postal_code, deleted_at)",
    )
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) throw new Error("Engagement not found.");

  const { data: firmRow } = await admin
    .from("firms")
    .select(
      "name, legal_name, address_line_1, address_city, address_region, address_postal_code, phone, email, website, logo_url, accent_color",
    )
    .eq("id", ctx.firm.id)
    .maybeSingle();
  if (!firmRow) throw new Error("Firm record missing.");

  const company = (
    eng as unknown as {
      company: {
        id: string;
        name: string;
        legal_name: string | null;
        address_line_1: string | null;
        address_city: string | null;
        address_region: string | null;
        address_postal_code: string | null;
      };
    }
  ).company;

  // Pull the client manager's name + email for the recipient
  // block. Falls back to "client" if no manager (shouldn't happen
  // for an engaged company).
  const { data: clientManager } = await admin
    .from("company_members")
    .select("user_id, profiles!inner(full_name, email)")
    .eq("company_id", eng.company_id)
    .eq("role", "manager")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const clientProfile =
    (clientManager as unknown as { profiles?: { full_name: string | null; email: string } })
      ?.profiles ?? null;

  const { html, filename } = generateEngagementLetterHTML({
    firm: {
      name: firmRow.name,
      legal_name: firmRow.legal_name,
      address_line_1: firmRow.address_line_1,
      address_city: firmRow.address_city,
      address_region: firmRow.address_region,
      address_postal_code: firmRow.address_postal_code,
      phone: firmRow.phone,
      email: firmRow.email,
      website: firmRow.website,
      logo_url: firmRow.logo_url,
      accent_color: firmRow.accent_color,
    },
    client: {
      full_name: clientProfile?.full_name ?? null,
      business_name: company.name,
      business_address: [
        company.address_line_1,
        company.address_city,
        company.address_region,
        company.address_postal_code,
      ]
        .filter(Boolean)
        .join(", "),
      email: clientProfile?.email ?? "client@example.com",
    },
    engagement: {
      kind: eng.kind as "tax_prep",
      tax_year: eng.tax_year,
      scope_summary: eng.scope_summary,
      fee_estimate_cents: null,
    },
    effective_date: new Date().toISOString().slice(0, 10),
  });

  // Insert the firm_documents row first to get an id we can use in
  // the storage path. Stamping the id in the path keeps the file
  // discoverable from the DB row without a separate join.
  const { data: docRow, error: insertErr } = await admin
    .from("firm_documents")
    .insert({
      firm_id: ctx.firm.id,
      engagement_id: engagementId,
      company_id: eng.company_id,
      uploader_user_id: user.id,
      kind: "engagement_letter",
      status: "ready_for_review",
      provider: "generated",
      filename,
      content_type: "text/html",
      size_bytes: new Blob([html]).size,
      tax_year: eng.tax_year,
      storage_path: "", // patched below
    })
    .select("id")
    .single();
  if (insertErr || !docRow) {
    throw new Error(insertErr?.message ?? "Failed to create document row.");
  }

  const storagePath = `firms/${ctx.firm.id}/engagements/${engagementId}/${docRow.id}.html`;
  // Upload bytes. Service-role client bypasses RLS on storage
  // policy; in production set bucket-level policies + signed URLs
  // for client download.
  const { error: uploadErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, html, {
      contentType: "text/html",
      upsert: true,
    });
  if (uploadErr) {
    // If the bucket doesn't exist yet (first deploy), log the path
    // so the operator can manually create it. The row still exists
    // and a follow-up "regenerate" action re-fires the upload.
    // eslint-disable-next-line no-console
    console.error(
      `[firm-documents] storage upload failed (${uploadErr.message}). Path: ${storagePath}`,
    );
  } else {
    // Patch the row with the resolved path.
    await admin
      .from("firm_documents")
      .update({ storage_path: storagePath })
      .eq("id", docRow.id);
  }

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: eng.company_id,
    engagementId,
    kind: "firm.tax_form_drafted",
    summary: `Generated engagement letter draft for ${company.name}.`,
    payload: {
      document_id: docRow.id,
      kind: "engagement_letter",
      tax_year: eng.tax_year,
    },
  });

  revalidatePath(`/firm/clients/${engagementId}/documents`);
  redirect(`/firm/clients/${engagementId}/documents`);
}

// Phase 11: auto-drafted Schedule C. Reads the client's books for
// the engagement's tax_year, maps every category to its IRS
// schedule_c_line, applies the 50% meals limitation, and writes a
// review-ready HTML draft to storage. The preparer reviews,
// fills Part III/IV/V if needed, and prints to PDF for filing.
export async function generateScheduleCDraft(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!engagementId) throw new Error("Missing engagement.");

  const { data: eng } = await admin
    .from("firm_engagements")
    .select(
      "id, firm_id, company_id, tax_year, kind, company:companies!inner(id, name, legal_name, ein, entity_type, address_line_1, address_city, address_region, address_postal_code, deleted_at)",
    )
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) throw new Error("Engagement not found.");
  const company = (
    eng as unknown as {
      company: {
        id: string;
        name: string;
        legal_name: string | null;
        ein: string | null;
        entity_type: string | null;
        address_line_1: string | null;
        address_city: string | null;
        address_region: string | null;
        address_postal_code: string | null;
        deleted_at: string | null;
      };
    }
  ).company;

  // Schedule C is for sole proprietors + single-member LLCs taxed
  // as disregarded entities. Block the action on entity types
  // that don't file it.
  const eligibleEntities = new Set([
    "sole_prop",
    "single_llc",
    "self_employed_1099",
  ]);
  if (
    company.entity_type &&
    !eligibleEntities.has(company.entity_type)
  ) {
    throw new Error(
      `Schedule C is for sole proprietors. This client is registered as ${company.entity_type}; use a different form.`,
    );
  }

  // Pull firm branding for the header.
  const { data: firmRow } = await admin
    .from("firms")
    .select("name, accent_color, logo_url")
    .eq("id", ctx.firm.id)
    .maybeSingle();
  if (!firmRow) throw new Error("Firm record missing.");

  // Pull the company owner's display name for the proprietor line.
  const { data: ownerRow } = await admin
    .from("company_members")
    .select("profiles!inner(full_name)")
    .eq("company_id", company.id)
    .eq("role", "manager")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const ownerName =
    (ownerRow as unknown as { profiles?: { full_name: string | null } })
      ?.profiles?.full_name ?? null;

  // Load aggregated income + expenses.
  const data = await loadScheduleCData(admin, company.id, eng.tax_year);

  const { html, filename } = renderScheduleCHTML({
    firm: {
      name: firmRow.name,
      accent_color: firmRow.accent_color,
      logo_url: firmRow.logo_url,
    },
    company: {
      name: company.name,
      legal_name: company.legal_name,
      ein: company.ein,
      address_line_1: company.address_line_1,
      address_city: company.address_city,
      address_region: company.address_region,
      address_postal_code: company.address_postal_code,
    },
    taxYear: eng.tax_year,
    owner: {
      full_name: ownerName,
      ssn: null,
    },
    income: {
      grossReceiptsCents: data.grossReceiptsCents,
      returnsCents: 0,
      otherIncomeCents: data.otherIncomeCents,
    },
    expensesByLine: data.expensesByLine,
    mealsDeductibleCents: data.mealsDeductibleCents,
    preparer: {
      full_name: (user.user_metadata?.full_name as string) ?? null,
      title: null,
      ptin: null,
    },
  });

  // Insert the document row, then upload bytes (same pattern as
  // the engagement-letter generator).
  const { data: docRow, error: insertErr } = await admin
    .from("firm_documents")
    .insert({
      firm_id: ctx.firm.id,
      engagement_id: engagementId,
      company_id: eng.company_id,
      uploader_user_id: user.id,
      kind: "schedule_c_draft",
      status: "ready_for_review",
      provider: "generated",
      filename,
      content_type: "text/html",
      size_bytes: new Blob([html]).size,
      tax_year: eng.tax_year,
      storage_path: "",
    })
    .select("id")
    .single();
  if (insertErr || !docRow) {
    throw new Error(insertErr?.message ?? "Failed to create document row.");
  }

  const storagePath = `firms/${ctx.firm.id}/engagements/${engagementId}/${docRow.id}.html`;
  const { error: uploadErr } = await admin.storage
    .from("firm-documents")
    .upload(storagePath, html, {
      contentType: "text/html",
      upsert: true,
    });
  if (uploadErr) {
    // eslint-disable-next-line no-console
    console.error(
      `[firm-documents] schedule-c upload failed (${uploadErr.message}). Path: ${storagePath}`,
    );
  } else {
    await admin
      .from("firm_documents")
      .update({ storage_path: storagePath })
      .eq("id", docRow.id);
  }

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: eng.company_id,
    engagementId,
    kind: "firm.tax_form_drafted",
    summary: `Drafted Schedule C for ${company.name} (tax year ${eng.tax_year}).`,
    payload: {
      document_id: docRow.id,
      kind: "schedule_c_draft",
      tax_year: eng.tax_year,
      gross_receipts_cents: data.grossReceiptsCents,
      total_expenses_cents: Array.from(data.expensesByLine.values()).reduce(
        (a, c) => a + c,
        0,
      ),
    },
  });

  revalidatePath(`/firm/clients/${engagementId}/documents`);
  redirect(`/firm/clients/${engagementId}/documents`);
}

// Tier 1 #2: Send a generated document for e-signature.
//
// Pulls the stored HTML, renders it to PDF, hands the PDF bytes to
// the configured e-signature provider (Documenso default,
// DocuSign on the enterprise tier), creates the envelope with the
// recipient as the signer, updates the document row with the
// envelope id + status='awaiting_signature'.
//
// The recipient gets an email from the provider with the
// signing URL. Provider webhooks (Phase 5's /api/webhooks/documenso)
// flip the document to 'signed' on completion.
export async function sendDocumentForSignature(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const documentId = String(formData.get("document_id") ?? "");
  const recipientEmail = String(formData.get("recipient_email") ?? "")
    .trim()
    .toLowerCase();
  const recipientName =
    String(formData.get("recipient_name") ?? "").trim() || null;
  if (!documentId) throw new Error("Missing document id.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) {
    throw new Error("Provide a valid recipient email.");
  }

  // Pull the document + verify firm ownership.
  const { data: doc } = await admin
    .from("firm_documents")
    .select(
      "id, firm_id, engagement_id, company_id, kind, status, storage_path, filename",
    )
    .eq("id", documentId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!doc) throw new Error("Document not found.");
  if (doc.status === "signed" || doc.status === "filed") {
    throw new Error("Document is already signed.");
  }
  if (doc.status === "awaiting_signature") {
    throw new Error(
      "An envelope is already out for this document. Void it before sending another.",
    );
  }
  if (!doc.storage_path) {
    throw new Error("Document has no stored content yet — regenerate first.");
  }

  // Fetch the stored HTML.
  const { data: blob, error: dlErr } = await admin.storage
    .from("firm-documents")
    .download(doc.storage_path);
  if (dlErr || !blob) {
    throw new Error(`Failed to read stored document: ${dlErr?.message ?? "unknown"}`);
  }
  const html = await blob.text();

  // Render to PDF for the envelope.
  const { renderHtmlToPdf } = await import("@/lib/firm/documents/render-pdf");
  const pdfBytes = await renderHtmlToPdf({ html });

  // Resolve provider for the firm's tier.
  const { getEsigProvider } = await import("@/lib/firm/esignature/provider");
  const provider = await getEsigProvider(
    ctx.firm.tier as "starter" | "growth" | "firm" | "enterprise",
  );
  if (!provider) {
    throw new Error(
      "No e-signature provider configured. Set DOCUMENSO_API_URL + DOCUMENSO_API_KEY in env to enable.",
    );
  }

  // Create the envelope. We send the inviter as a CC so they get a
  // copy of the completed envelope.
  const envelope = await provider.createEnvelope({
    externalId: doc.id,
    title: doc.filename.replace(/\.html?$/i, ""),
    pdfBuffer: pdfBytes,
    recipients: [
      { email: recipientEmail, name: recipientName ?? undefined, role: "signer" },
      ...(user.email
        ? [
            {
              email: user.email,
              name: (user.user_metadata?.full_name as string) ?? undefined,
              role: "cc" as const,
            },
          ]
        : []),
    ],
    metadata: {
      firm_document_id: doc.id,
      firm_id: doc.firm_id,
      engagement_id: doc.engagement_id ?? "",
    },
  });
  if (!envelope.ok) {
    throw new Error(envelope.reason ?? "Envelope creation failed.");
  }

  await admin
    .from("firm_documents")
    .update({
      status: "awaiting_signature",
      provider: provider.id,
      provider_envelope_id: envelope.envelopeId,
      sent_at: new Date().toISOString(),
    })
    .eq("id", doc.id);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: doc.company_id,
    engagementId: doc.engagement_id,
    kind: "firm.signature_requested",
    summary: `Sent ${doc.filename} to ${recipientEmail} for signature via ${provider.id}.`,
    payload: {
      document_id: doc.id,
      provider: provider.id,
      envelope_id: envelope.envelopeId,
      recipient_email: recipientEmail,
    },
  });

  revalidatePath(`/firm/clients/${doc.engagement_id}/documents`);
}

// Phase 11.5: K-1 batch generator. Reads partner / shareholder list
// from the company's `business_profile.k1_partners` (JSONB) column;
// if that's not populated we fall back to a single 100% K-1 for the
// company's manager. Each partner gets one HTML doc.
export async function generateK1Drafts(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!engagementId) throw new Error("Missing engagement.");

  const { data: eng } = await admin
    .from("firm_engagements")
    .select(
      "id, firm_id, company_id, tax_year, company:companies!inner(id, name, legal_name, ein, entity_type, address_line_1, address_city, address_region, address_postal_code, deleted_at)",
    )
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) throw new Error("Engagement not found.");
  const company = (
    eng as unknown as {
      company: {
        id: string;
        name: string;
        legal_name: string | null;
        ein: string | null;
        entity_type: string | null;
        address_line_1: string | null;
        address_city: string | null;
        address_region: string | null;
        address_postal_code: string | null;
        deleted_at: string | null;
      };
    }
  ).company;

  // Variant from entity type.
  const variant: K1Variant | null =
    company.entity_type === "partnership" || company.entity_type === "multi_llc"
      ? "partnership"
      : company.entity_type === "s_corp"
        ? "s_corp"
        : null;
  if (!variant) {
    throw new Error(
      `K-1 only applies to partnerships and S-Corps. This client is ${company.entity_type ?? "unknown"}.`,
    );
  }

  const { data: firmRow } = await admin
    .from("firms")
    .select("name, accent_color, logo_url")
    .eq("id", ctx.firm.id)
    .maybeSingle();
  if (!firmRow) throw new Error("Firm record missing.");

  // Resolve partners. Optional `business_profiles.k1_partners` JSONB
  // gives the firm a place to maintain the partner / shareholder
  // list. When missing, we generate a single 100% K-1 for the
  // company manager as a starting point the preparer edits.
  const { data: biz } = await admin
    .from("business_profiles")
    .select("k1_partners")
    .eq("company_id", company.id)
    .maybeSingle();
  type StoredPartner = {
    name: string;
    ownership_pct: number;
    partner_type?: "general" | "limited";
    address?: string;
    tin_placeholder?: string;
  };
  let partners: StoredPartner[] = Array.isArray(biz?.k1_partners)
    ? (biz!.k1_partners as StoredPartner[])
    : [];
  if (partners.length === 0) {
    const { data: ownerRow } = await admin
      .from("company_members")
      .select("profiles!inner(full_name, email)")
      .eq("company_id", company.id)
      .eq("role", "manager")
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const ownerProfile =
      (ownerRow as unknown as { profiles?: { full_name: string | null; email: string } })
        ?.profiles ?? null;
    partners = [
      {
        name: ownerProfile?.full_name ?? ownerProfile?.email ?? company.name,
        ownership_pct: 1,
      },
    ];
  }

  const totals = await loadK1Data(admin, company.id, eng.tax_year);
  const created: string[] = [];

  for (const p of partners) {
    const { html, filename } = renderK1HTML(
      {
        variant,
        firm: {
          name: firmRow.name,
          accent_color: firmRow.accent_color,
          logo_url: firmRow.logo_url,
        },
        company: {
          name: company.name,
          legal_name: company.legal_name,
          ein: company.ein,
          address_line_1: company.address_line_1,
          address_city: company.address_city,
          address_region: company.address_region,
          address_postal_code: company.address_postal_code,
        },
        taxYear: eng.tax_year,
        totals,
        partners,
        preparer: {
          full_name: (user.user_metadata?.full_name as string) ?? null,
          ptin: null,
        },
      },
      {
        name: p.name,
        ownership_pct: p.ownership_pct,
        partner_type: p.partner_type,
        address: p.address ?? null,
        tin_placeholder: p.tin_placeholder,
      },
    );

    const { data: docRow, error: insertErr } = await admin
      .from("firm_documents")
      .insert({
        firm_id: ctx.firm.id,
        engagement_id: engagementId,
        company_id: eng.company_id,
        uploader_user_id: user.id,
        kind: "k1_draft",
        status: "ready_for_review",
        provider: "generated",
        filename,
        content_type: "text/html",
        size_bytes: new Blob([html]).size,
        tax_year: eng.tax_year,
        storage_path: "",
        notes: `K-1 for ${p.name} (${(p.ownership_pct * 100).toFixed(2)}%)`,
      })
      .select("id")
      .single();
    if (insertErr || !docRow) continue;

    const storagePath = `firms/${ctx.firm.id}/engagements/${engagementId}/${docRow.id}.html`;
    await admin.storage
      .from("firm-documents")
      .upload(storagePath, html, {
        contentType: "text/html",
        upsert: true,
      });
    await admin
      .from("firm_documents")
      .update({ storage_path: storagePath })
      .eq("id", docRow.id);
    created.push(docRow.id);
  }

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: eng.company_id,
    engagementId,
    kind: "firm.tax_form_drafted",
    summary: `Drafted ${created.length} K-1${created.length === 1 ? "" : "s"} for ${company.name} (tax year ${eng.tax_year}).`,
    payload: {
      variant,
      partner_count: partners.length,
      document_ids: created,
      tax_year: eng.tax_year,
    },
  });

  revalidatePath(`/firm/clients/${engagementId}/documents`);
  redirect(`/firm/clients/${engagementId}/documents`);
}

// Phase 11.5: 1099 batch. Walks every recipient whose YTD payments
// meet the $600 threshold and produces one HTML draft per. Variant
// is selectable: NEC (contract labor) or MISC (rents + royalties).
export async function generate1099Batch(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const engagementId = String(formData.get("engagement_id") ?? "");
  const variantRaw = String(formData.get("variant") ?? "1099-NEC");
  if (!engagementId) throw new Error("Missing engagement.");
  const variant =
    variantRaw === "1099-MISC" ? "1099-MISC" : "1099-NEC";

  const { data: eng } = await admin
    .from("firm_engagements")
    .select(
      "id, firm_id, company_id, tax_year, company:companies!inner(id, name, legal_name, ein, address_line_1, address_city, address_region, address_postal_code, phone, deleted_at)",
    )
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) throw new Error("Engagement not found.");
  const company = (
    eng as unknown as {
      company: {
        id: string;
        name: string;
        legal_name: string | null;
        ein: string | null;
        address_line_1: string | null;
        address_city: string | null;
        address_region: string | null;
        address_postal_code: string | null;
        phone: string | null;
      };
    }
  ).company;

  const { data: firmRow } = await admin
    .from("firms")
    .select("name, accent_color, logo_url")
    .eq("id", ctx.firm.id)
    .maybeSingle();
  if (!firmRow) throw new Error("Firm record missing.");

  const baseInput = {
    variant: variant as "1099-NEC" | "1099-MISC",
    firm: {
      name: firmRow.name,
      accent_color: firmRow.accent_color,
      logo_url: firmRow.logo_url,
    },
    payer: {
      name: company.name,
      legal_name: company.legal_name,
      ein: company.ein,
      address_line_1: company.address_line_1,
      address_city: company.address_city,
      address_region: company.address_region,
      address_postal_code: company.address_postal_code,
      phone: company.phone,
    },
    taxYear: eng.tax_year,
    recipients: [] as never,
    preparer: {
      full_name: (user.user_metadata?.full_name as string) ?? null,
      ptin: null,
    },
  };

  type RecipientBundle = Array<{
    recipient: Awaited<ReturnType<typeof loadNECRecipients>>[number];
    miscBox?: "rents" | "royalties";
    docKind: "1099_nec_draft" | "1099_misc_draft";
  }>;
  const todo: RecipientBundle = [];

  if (variant === "1099-NEC") {
    const recipients = await loadNECRecipients(admin, company.id, eng.tax_year);
    for (const r of recipients) {
      todo.push({ recipient: r, docKind: "1099_nec_draft" });
    }
  } else {
    const { rents, royalties } = await loadMISCRecipients(
      admin,
      company.id,
      eng.tax_year,
    );
    for (const r of rents) {
      todo.push({ recipient: r, miscBox: "rents", docKind: "1099_misc_draft" });
    }
    for (const r of royalties) {
      todo.push({
        recipient: r,
        miscBox: "royalties",
        docKind: "1099_misc_draft",
      });
    }
  }

  if (todo.length === 0) {
    throw new Error(
      `No recipients hit the $600 ${variant} threshold for ${eng.tax_year}.`,
    );
  }

  const created: string[] = [];
  for (const t of todo) {
    const { html, filename } = render1099HTML(
      baseInput,
      t.recipient,
      t.miscBox ?? "rents",
    );
    const { data: docRow } = await admin
      .from("firm_documents")
      .insert({
        firm_id: ctx.firm.id,
        engagement_id: engagementId,
        company_id: eng.company_id,
        uploader_user_id: user.id,
        kind: t.docKind,
        status: "ready_for_review",
        provider: "generated",
        filename,
        content_type: "text/html",
        size_bytes: new Blob([html]).size,
        tax_year: eng.tax_year,
        storage_path: "",
        notes: `${variant} for ${t.recipient.name} ($${(t.recipient.total_cents / 100).toFixed(2)})`,
      })
      .select("id")
      .single();
    if (!docRow) continue;
    const path = `firms/${ctx.firm.id}/engagements/${engagementId}/${docRow.id}.html`;
    await admin.storage
      .from("firm-documents")
      .upload(path, html, { contentType: "text/html", upsert: true });
    await admin
      .from("firm_documents")
      .update({ storage_path: path })
      .eq("id", docRow.id);
    created.push(docRow.id);
  }

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: eng.company_id,
    engagementId,
    kind: "firm.tax_form_drafted",
    summary: `Drafted ${created.length} ${variant} form${created.length === 1 ? "" : "s"} for ${company.name}.`,
    payload: {
      variant,
      recipient_count: todo.length,
      document_ids: created,
      tax_year: eng.tax_year,
    },
  });

  revalidatePath(`/firm/clients/${engagementId}/documents`);
  redirect(`/firm/clients/${engagementId}/documents`);
}

export async function archiveDocument(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "manager") {
    throw new Error("Only firm owners or managers can archive documents.");
  }
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!id) throw new Error("Missing document id.");
  const { error } = await admin
    .from("firm_documents")
    .update({ status: "archived" })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/firm/clients/${engagementId}/documents`);
}
