"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";
import {
  loadCalendarProvider,
  type FirmCalendarProviderId,
} from "@/lib/firm/scheduling/provider";

// Schedule a meeting for an engagement.
//
// Two modes:
//   - Auto-mint: if the organizer has a connected calendar
//     integration of the requested provider, we call the provider
//     API + record the resulting meeting URL.
//   - Manual: organizer enters the meeting URL themselves (or
//     leaves it blank for an in-person meeting). The row is still
//     recorded so the engagement timeline has it.
//
// We never block on provider API failures, the row is created
// either way; provider_event_id stays NULL when auto-mint fails
// and the organizer can paste the URL manually as a follow-up.

const VALID_KINDS = new Set([
  "intro",
  "planning",
  "review",
  "signing",
  "training",
  "other",
]);
const VALID_PROVIDERS = new Set<FirmCalendarProviderId | "manual">([
  "zoom",
  "google",
  "microsoft",
  "manual",
]);

export async function scheduleMeeting(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!engagementId) throw new Error("Missing engagement.");

  const kindRaw = String(formData.get("kind") ?? "planning");
  const kind = VALID_KINDS.has(kindRaw) ? kindRaw : "planning";

  const startsAt = String(formData.get("starts_at") ?? "");
  const durationRaw = Number(formData.get("duration_minutes"));
  const durationMinutes =
    Number.isFinite(durationRaw) && durationRaw > 0 && durationRaw < 480
      ? Math.floor(durationRaw)
      : 30;
  if (!startsAt || isNaN(new Date(startsAt).getTime())) {
    throw new Error("Provide a valid start time.");
  }

  const providerRaw = String(formData.get("provider") ?? "manual");
  const provider = VALID_PROVIDERS.has(
    providerRaw as FirmCalendarProviderId | "manual",
  )
    ? (providerRaw as FirmCalendarProviderId | "manual")
    : "manual";

  const manualUrl = String(formData.get("meeting_url") ?? "").trim() || null;
  const agenda = String(formData.get("agenda") ?? "").trim() || null;
  const clientEmail =
    String(formData.get("client_email") ?? "").trim().toLowerCase() || null;
  const clientName =
    String(formData.get("client_name") ?? "").trim() || null;

  // Load engagement for company_id.
  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, firm_id, company_id, tax_year, company:companies!inner(id, name)")
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) throw new Error("Engagement not found.");

  // Phase 10.5: decode via the token vault (AES-256-GCM for new
  // connections, plain-base64 fallback for legacy v0 blobs).
  let providerEventId: string | null = null;
  let meetingUrl: string | null = manualUrl;
  if (provider !== "manual") {
    const { data: integration } = await admin
      .from("firm_calendar_integrations")
      .select("id, provider_account_email, encrypted_token_blob")
      .eq("firm_id", ctx.firm.id)
      .eq("user_id", user.id)
      .eq("provider", provider)
      .maybeSingle();
    const { decodeAccessToken } = await import("@/lib/firm/oauth/token-vault");
    const accessToken = decodeAccessToken(
      integration?.encrypted_token_blob ?? null,
    );
    if (accessToken) {
      const adapter = await loadCalendarProvider(provider);
      if (adapter) {
        const res = await adapter.createMeeting(accessToken, {
          title: `Meeting · ${(eng as unknown as { company: { name: string } }).company.name}`,
          description: agenda ?? undefined,
          startsAt,
          durationMinutes,
          recipients: [
            { email: user.email ?? "host@taxottic.com", name: user.user_metadata?.full_name as string | undefined },
            ...(clientEmail ? [{ email: clientEmail, name: clientName ?? undefined }] : []),
          ],
          timezone: "UTC",
        });
        if (res.ok) {
          providerEventId = res.providerEventId ?? null;
          meetingUrl = res.meetingUrl ?? meetingUrl;
        } else {
           
          console.warn(
            `[meetings] provider auto-mint failed: ${res.reason ?? "unknown"}, falling through to manual.`,
          );
        }
      }
    }
  }

  const { data: meeting, error } = await admin
    .from("firm_meetings")
    .insert({
      firm_id: ctx.firm.id,
      engagement_id: engagementId,
      company_id: eng.company_id,
      organizer_user_id: user.id,
      client_email: clientEmail,
      client_name: clientName,
      kind,
      starts_at: startsAt,
      duration_minutes: durationMinutes,
      provider: provider === "manual" ? null : provider,
      provider_event_id: providerEventId,
      meeting_url: meetingUrl,
      agenda,
    })
    .select("id")
    .single();
  if (error || !meeting) throw new Error(error?.message ?? "Insert failed.");

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: eng.company_id,
    engagementId,
    kind: "firm.meeting_scheduled",
    summary: `Scheduled ${kind} meeting on ${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(startsAt))} (${durationMinutes} min).`,
    payload: {
      meeting_id: meeting.id,
      provider,
      meeting_url: meetingUrl,
      starts_at: startsAt,
    },
  });

  revalidatePath(`/firm/clients/${engagementId}/meetings`);
  redirect(`/firm/clients/${engagementId}/meetings`);
}

export async function cancelMeeting(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!id) throw new Error("Missing meeting id.");

  await admin
    .from("firm_meetings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);

  revalidatePath(`/firm/clients/${engagementId}/meetings`);
}
