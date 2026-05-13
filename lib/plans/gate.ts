import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveFeatureGates } from "./usage";
import type { FeatureGates } from "./limits";

/**
 * Server-side feature-gate enforcement for API routes.
 *
 * Page-level guards already hide the relevant UI on free / lower
 * tiers, but the underlying API endpoints (Plaid, Bella, OCR) are
 * publicly reachable for any authenticated user. Without gating
 * server-side, a free user (or anyone curl-ing the endpoint) bypasses
 * the UI gate and burns provider spend on Anthropic / Plaid / Stripe.
 *
 * Returns a 403 NextResponse when the user's plan does not allow the
 * requested feature, otherwise returns null and the caller proceeds.
 *
 * Usage:
 *
 *   const gateFail = await requireFeatureGate(supabase, user.id, "bella");
 *   if (gateFail) return gateFail;
 *
 * Keep the gate name aligned with FEATURE_GATES keys in lib/plans/limits.ts
 * so a TypeScript change to the gates flow through to call sites.
 */
export async function requireFeatureGate(
  supabase: SupabaseClient,
  userId: string,
  feature: keyof FeatureGates,
): Promise<NextResponse | null> {
  const { plan, gates } = await getActiveFeatureGates(supabase, userId);
  if (gates[feature]) return null;
  return NextResponse.json(
    {
      error: "plan_required",
      feature,
      plan,
      message: messageFor(feature),
    },
    { status: 403 },
  );
}

function messageFor(feature: keyof FeatureGates): string {
  switch (feature) {
    case "bella":
      return "Bella is included on the Filer plan and above. Upgrade at /billing to unlock it.";
    case "bankConnect":
      return "Live bank sync is included on the Solo plan and above. Upgrade at /billing to connect a bank.";
    case "csvImport":
      return "CSV import is included on the Solo plan and above. Upgrade at /billing to import transactions.";
    case "csvBulk":
      return "Bulk CSV import (1k+ rows) is included on the Studio plan and above.";
    case "personalForecast":
      return "Personal forecast is included on the Filer plan and above.";
    case "businessForecast":
      return "Business forecast is included on the Solo plan and above.";
    case "teamChat":
      return "Team chat is included on the Studio plan and above.";
    case "inviteEmployees":
      return "Inviting employees is included on the Studio plan and above.";
    case "taxPreparer":
      return "Engaging a tax preparer is included on the Filer plan and above.";
    case "multiCompany":
      return "Multiple companies require the Studio plan and above.";
    case "multiState":
      return "Multi-state forecasting requires the Studio plan and above.";
    case "prioritySupport":
      return "Priority support requires the Scale plan and above.";
    case "auditSupport":
      return "Audit support requires the Scale plan and above.";
    case "whiteLabel":
      return "White-label PDFs require the Practice plan.";
    case "apiAccess":
      return "API access requires the Scale plan and above.";
    case "preparerCenter":
      return "Preparer center requires the Practice plan.";
    default:
      return "This feature requires a higher plan.";
  }
}
