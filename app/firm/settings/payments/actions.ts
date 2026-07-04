"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import {
  createConnectAccount,
  createAccountOnboardingLink,
  fetchConnectAccountStatus,
} from "@/lib/firm/payments/stripe-connect";
import { logFirmActivity } from "@/lib/firm/activity";

// Server actions for /firm/settings/payments.
//
// Three operations:
//   1. startStripeConnect, if no account exists yet, create one;
//      then mint an Account Link and redirect the firm into Stripe's
//      hosted onboarding.
//   2. refreshStripeStatus, re-read the live status from Stripe
//      and patch the local mirror. Called when the firm returns
//      from onboarding; also exposed as a manual button.
//   3. (webhook keeps the mirror fresh between manual refreshes -
//      see /api/webhooks/stripe-connect)

function origin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com";
}

export async function startStripeConnect(): Promise<void> {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const { data: firmRow } = await admin
    .from("firms")
    .select("name, email")
    .eq("id", ctx.firm.id)
    .maybeSingle();
  if (!firmRow?.email) {
    throw new Error("Firm needs a contact email before connecting Stripe.");
  }

  const { data: existing } = await admin
    .from("firm_stripe_accounts")
    .select("stripe_account_id")
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();

  let accountId = existing?.stripe_account_id ?? null;
  if (!accountId) {
    const created = await createConnectAccount({
      firmId: ctx.firm.id,
      firmName: firmRow.name,
      email: firmRow.email,
    });
    if (!created.ok) throw new Error(created.reason);
    accountId = created.accountId;
    await admin.from("firm_stripe_accounts").upsert(
      {
        firm_id: ctx.firm.id,
        stripe_account_id: accountId,
      },
      { onConflict: "firm_id" },
    );
    await logFirmActivity({
      client: admin,
      firmId: ctx.firm.id,
      kind: "firm.member_invited",
      summary: `Stripe Connect account created (${accountId}).`,
      payload: { stripe_account_id: accountId },
      actorSide: "firm",
    });
  }

  const o = origin();
  const link = await createAccountOnboardingLink(
    accountId,
    `${o}/firm/settings/payments?return=1`,
    `${o}/firm/settings/payments?refresh=1`,
  );
  if (!link.ok) throw new Error(link.reason);

  await admin
    .from("firm_stripe_accounts")
    .update({ last_dashboard_link_at: new Date().toISOString() })
    .eq("firm_id", ctx.firm.id);

  redirect(link.url);
}

export async function refreshStripeStatus(): Promise<void> {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();

  const { data: row } = await admin
    .from("firm_stripe_accounts")
    .select("stripe_account_id")
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!row?.stripe_account_id) {
    revalidatePath("/firm/settings/payments");
    return;
  }

  const live = await fetchConnectAccountStatus(row.stripe_account_id);
  if (!live.ok) {
     
    console.warn(`[stripe-connect] status refresh failed: ${live.reason}`);
    revalidatePath("/firm/settings/payments");
    return;
  }
  await admin
    .from("firm_stripe_accounts")
    .update({
      charges_enabled: live.charges_enabled,
      payouts_enabled: live.payouts_enabled,
      details_submitted: live.details_submitted,
      country: live.country ?? null,
      default_currency: live.default_currency ?? null,
    })
    .eq("firm_id", ctx.firm.id);

  revalidatePath("/firm/settings/payments");
}
