"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";
import { sendEmail } from "@/lib/email/transport";
import { renderFirmInviteClientEmail } from "@/lib/email/templates/firm-invite-client";
import {
  parseCsv,
  validateInviteRow,
  type FirmInviteRowParsed,
  type FirmInviteRowError,
} from "@/lib/firm/csv";

// Bulk client onboarding. The firm pastes a CSV (or types up to 200
// rows) and the server walks each row in the same email-sniff loop
// used by the single-client invite:
//
//   - Existing Taxottic user with a company → upsert firm_engagements
//     (status='pending_client'), email branded "you have an
//     engagement" link.
//   - Anyone else → firm_client_outreach row + branded magic-link
//     style email. The existing convert_firm_outreach() RPC promotes
//     it to an engagement once the prospect signs up.
//
// Errors are collected per row rather than throwing — the action
// returns a summary message via redirect to /firm/outreach where the
// firm can see what happened. Emails are sent best-effort (failures
// are logged but don't roll back the DB writes).

const MAX_ROWS = 200;

type Summary = {
  totalRows: number;
  invitedExisting: number;
  invitedOutreach: number;
  errors: FirmInviteRowError[];
};

function prettyKind(k: string): string {
  return (
    {
      tax_prep: "tax preparation",
      audit_support: "audit response",
      bookkeeping: "bookkeeping",
      advisory: "advisory",
    }[k] ?? k
  );
}

export async function bulkInviteClients(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "manager") {
    throw new Error("Only firm owners or managers can run bulk imports.");
  }

  const csv = String(formData.get("csv") ?? "").trim();
  const defaultKind = String(formData.get("default_kind") ?? "tax_prep");
  const defaultTaxYearRaw = Number(formData.get("default_tax_year"));
  const defaultTaxYear =
    Number.isFinite(defaultTaxYearRaw) &&
    defaultTaxYearRaw >= 2020 &&
    defaultTaxYearRaw <= 2100
      ? Math.floor(defaultTaxYearRaw)
      : new Date().getUTCFullYear();

  if (!csv) {
    throw new Error("Paste the CSV in the textarea or upload a file.");
  }

  const { rows } = parseCsv(csv);
  if (rows.length === 0) {
    throw new Error("No data rows found. The first line must be a header.");
  }
  if (rows.length > MAX_ROWS) {
    throw new Error(
      `Too many rows (${rows.length}). Split into batches of ${MAX_ROWS} or fewer.`,
    );
  }

  const summary: Summary = {
    totalRows: rows.length,
    invitedExisting: 0,
    invitedOutreach: 0,
    errors: [],
  };

  // Dedupe within-batch by email; later rows with the same email
  // overwrite earlier ones rather than create two outreach records.
  const dedup = new Map<string, { row: FirmInviteRowParsed; rowNumber: number }>();
  rows.forEach((raw, idx) => {
    const result = validateInviteRow(raw, idx + 2, {
      kind: defaultKind,
      taxYear: defaultTaxYear,
    });
    if (!result.ok) {
      summary.errors.push(result.error);
      return;
    }
    dedup.set(result.row.email, {
      row: result.row,
      rowNumber: idx + 2,
    });
  });

  for (const { row, rowNumber } of dedup.values()) {
    try {
      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", row.email)
        .maybeSingle();

      let engagementId: string | null = null;
      let companyPublicId: string | null = null;
      if (existing?.id) {
        const { data: managerMembership } = await admin
          .from("company_members")
          .select(
            "company_id, joined_at, company:companies!inner(id, public_id, deleted_at)",
          )
          .eq("user_id", existing.id)
          .eq("role", "manager")
          .is("company.deleted_at", null)
          .order("joined_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (managerMembership?.company_id) {
          const { data: eng, error: engErr } = await admin
            .from("firm_engagements")
            .upsert(
              {
                firm_id: ctx.firm.id,
                company_id: managerMembership.company_id,
                tax_year: row.tax_year,
                kind: row.kind,
                status: "pending_client",
                requested_by: user.id,
                requested_by_side: "firm",
                scope_summary: row.message,
              },
              { onConflict: "firm_id,company_id,tax_year,kind" },
            )
            .select("id")
            .single();
          if (engErr) {
            summary.errors.push({
              rowNumber,
              email: row.email,
              reason: engErr.message,
            });
            continue;
          }
          engagementId = eng?.id ?? null;
          // Supabase types the nested `company` as the inner row
          // shape; the unknown-cast keeps the assertion explicit
          // without leaning on the auto-derived array form.
          companyPublicId =
            (
              managerMembership as unknown as {
                company: { public_id: string } | null;
              }
            ).company?.public_id ?? null;
          summary.invitedExisting += 1;

          await logFirmActivity({
            client: admin,
            firmId: ctx.firm.id,
            companyId: managerMembership.company_id,
            engagementId,
            kind: "firm.engagement_created",
            summary: `Bulk-invited ${row.email} (existing user) to ${prettyKind(row.kind)} ${row.tax_year}.`,
            payload: {
              email: row.email,
              full_name: row.full_name,
              business_name: row.business_name,
              source: "bulk_import",
            },
          });
        }
      }

      if (!engagementId) {
        // Outreach path. Email is brand-new OR doesn't manage a
        // company yet.
        const { error: outErr, data: outreach } = await admin
          .from("firm_client_outreach")
          .insert({
            firm_id: ctx.firm.id,
            email: row.email,
            full_name: row.full_name,
            business_name: row.business_name,
            tax_year: row.tax_year,
            kind: row.kind,
            message: row.message,
            invited_by: user.id,
          })
          .select("id")
          .single();
        if (outErr) {
          summary.errors.push({
            rowNumber,
            email: row.email,
            reason: outErr.message,
          });
          continue;
        }
        summary.invitedOutreach += 1;
        await logFirmActivity({
          client: admin,
          firmId: ctx.firm.id,
          kind: "firm.engagement_created",
          summary: `Bulk-outreach ${row.email} for ${prettyKind(row.kind)} ${row.tax_year} (not on Taxottic yet).`,
          payload: {
            outreach_id: outreach?.id,
            email: row.email,
            full_name: row.full_name,
            business_name: row.business_name,
            source: "bulk_import",
          },
        });
      }

      // Send the email. Accept URL differs based on whether the
      // user already has a Taxottic account.
      const acceptUrl =
        companyPublicId && engagementId
          ? `https://taxottic.com/login?next=${encodeURIComponent(
              `/c/${companyPublicId}/preparer?engagementId=${engagementId}`,
            )}`
          : `https://taxottic.com/login?next=${encodeURIComponent(
              "/dashboard?from=firm-invite",
            )}`;
      const rendered = renderFirmInviteClientEmail({
        firmName: ctx.firm.name,
        firmSlug: ctx.firm.slug ?? "enterprise",
        firmLogoUrl: ctx.firm.logo_url,
        firmAccentColor: ctx.firm.accent_color,
        recipientName: row.full_name,
        engagementKindLabel: prettyKind(row.kind),
        taxYear: row.tax_year,
        message: row.message,
        inviterName: user.user_metadata?.full_name as string | undefined,
        inviterEmail: user.email ?? null,
        acceptUrl,
      });
      await sendEmail({
        to: row.email,
        fromName: rendered.fromName,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo: rendered.replyTo,
        tags: {
          kind: "firm-invite-bulk",
          firm_slug: ctx.firm.slug ?? "no-slug",
        },
      });
    } catch (err) {
      summary.errors.push({
        rowNumber,
        email: row.email,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  // Aggregate activity-log event so the cockpit sidebar sees one
  // batch row, not 100 of them.
  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.engagement_created",
    summary: `Bulk import: ${summary.invitedExisting + summary.invitedOutreach} invitation${
      summary.invitedExisting + summary.invitedOutreach === 1 ? "" : "s"
    } sent · ${summary.errors.length} error${summary.errors.length === 1 ? "" : "s"}.`,
    payload: {
      total_rows: summary.totalRows,
      invited_existing: summary.invitedExisting,
      invited_outreach: summary.invitedOutreach,
      error_count: summary.errors.length,
      source: "bulk_import_summary",
    },
  });

  revalidatePath("/firm");
  revalidatePath("/firm/outreach");
  // Carry the summary forward via search params so the redirect
  // target can render the result panel.
  const params = new URLSearchParams({
    total: String(summary.totalRows),
    existing: String(summary.invitedExisting),
    outreach: String(summary.invitedOutreach),
    errors: String(summary.errors.length),
  });
  redirect(`/firm/outreach?import=1&${params.toString()}`);
}
