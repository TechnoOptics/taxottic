import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

// Header set by middleware on every request whose host is
// {slug}.taxottic.com. Server components read it to pick the
// "current firm" before falling back to profiles.active_firm_id.
const FIRM_SLUG_HEADER = "x-taxottic-firm-slug";
const FIRM_CUSTOM_HOST_HEADER = "x-taxottic-firm-custom-host";

/**
 * Read the firm slug embedded in the host by the wildcard-subdomain
 * middleware. Returns null on hosts that aren't firm subdomains
 * (consumer / HQ / enterprise / preview / localhost). Pages that
 * want firm-branded chrome (logo, color) can read this directly
 * without doing a DB lookup themselves.
 */
export async function firmSlugFromHost(): Promise<string | null> {
  const h = await headers();
  const slug = h.get(FIRM_SLUG_HEADER);
  return slug && slug.length > 0 ? slug : null;
}

/** Phase 2.5: BYO custom domain. Returns the host the firm
 *  attached (e.g., `firm.smithcpa-secure.com`) when the request
 *  arrived on a non-Taxottic domain. */
export async function firmCustomHostFromHeaders(): Promise<string | null> {
  const h = await headers();
  const host = h.get(FIRM_CUSTOM_HOST_HEADER);
  return host && host.length > 0 ? host : null;
}

// Phase 1 of the enterprise build: a single resolver for "what firm
// does the current user belong to?" Every firm-scoped page calls
// `requireFirmContext()` to get a typed { firm, membership } object
// or get redirected. `cache()` memoizes for the lifetime of one
// request so the dashboard + sidebar + activity stream can all reach
// for the same data without three Supabase round-trips.
//
// Resolution order:
//   1. If the user is a member of exactly one firm, return that.
//   2. If they're a member of multiple firms, pick the one stamped
//      on profiles.active_firm_id (a future column; for now we
//      default to the earliest-joined firm and surface a firm
//      switcher in the UserMenu).
//   3. If they're not a firm member at all, redirect to
//      /firms/request-account so the unauth splash + signup path
//      handles them.

export type FirmRecord = {
  id: string;
  public_id: string;
  slug: string | null; // subdomain slug — null for legacy firms until backfilled
  name: string;
  legal_name: string | null;
  logo_url: string | null;
  accent_color: string | null;
  status: "pending" | "active" | "suspended";
  tier: "starter" | "growth" | "firm" | "enterprise";
  client_seats_limit: number | null;
  preparer_seats_limit: number | null;
};

export type FirmMembership = {
  firm_id: string;
  role: "owner" | "manager" | "preparer" | "reviewer";
  title: string | null;
  joined_at: string;
};

export type FirmContext = {
  firm: FirmRecord;
  membership: FirmMembership;
  /** All firms this user has any role in — surfaced in the firm
   *  switcher when length > 1. Empty for the typical single-firm
   *  preparer. */
  allFirms: FirmRecord[];
};

/**
 * Cheap read-only resolver for the current user's firm context.
 * Returns null when the user is not a firm member; callers decide
 * whether to redirect or render a different surface.
 */
export const getFirmContext = cache(_getFirmContext);

async function _getFirmContext(): Promise<FirmContext | null> {
  const { user } = await requireUser();
  const admin = createServiceClient();

  // Pull every firm membership for this user. Service-role read so
  // RLS doesn't gate on `is_firm_member` (we're computing
  // membership; circular dependency otherwise).
  const { data: memberships } = await admin
    .from("firm_members")
    .select(
      "firm_id, role, title, joined_at, firm:firms!inner(id, public_id, slug, name, legal_name, logo_url, accent_color, status, tier, client_seats_limit, preparer_seats_limit)",
    )
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  if (!memberships || memberships.length === 0) return null;

  // Pick the active firm. Resolution order:
  //   1. If the host is a BYO custom domain, resolve via
  //      firm_custom_domains; if the user is a member of that
  //      firm we use it.
  //   2. If the host is {slug}.taxottic.com AND the user is a
  //      member of that firm, prefer it. Pinning the firm to the
  //      URL means a preparer who multi-firms can't accidentally
  //      act on the wrong client's data.
  //   3. Otherwise honor profiles.active_firm_id when set.
  //   4. Otherwise the earliest-joined firm wins.
  const hostSlug = await firmSlugFromHost();
  const customHost = await firmCustomHostFromHeaders();

  let customDomainFirmId: string | null = null;
  if (customHost) {
    const { data: domainRow } = await admin
      .from("firm_custom_domains")
      .select("firm_id")
      .ilike("hostname", customHost)
      .eq("status", "active")
      .maybeSingle();
    customDomainFirmId = (domainRow?.firm_id as string | null) ?? null;
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("active_firm_id")
    .eq("id", user.id)
    .maybeSingle();
  const preferredId = profile?.active_firm_id as string | null | undefined;

  type RawRow = (typeof memberships)[number] & {
    firm: FirmRecord;
  };
  const rows = memberships as unknown as RawRow[];
  const preferred =
    (customDomainFirmId &&
      rows.find((r) => r.firm.id === customDomainFirmId)) ||
    (hostSlug && rows.find((r) => r.firm.slug === hostSlug)) ||
    rows.find((r) => preferredId && r.firm.id === preferredId) ||
    rows[0];

  return {
    firm: preferred.firm,
    membership: {
      firm_id: preferred.firm_id,
      role: preferred.role,
      title: preferred.title,
      joined_at: preferred.joined_at,
    },
    allFirms: rows.map((r) => r.firm),
  };
}

/**
 * Hard-require firm context: redirect anywhere we can't find a
 * firm. Use on every page under /firm/*. Suspended-firm members
 * land on a "your firm is suspended" page rather than the cockpit
 * so they don't see a half-broken UI.
 */
export async function requireFirmContext(): Promise<FirmContext> {
  const ctx = await getFirmContext();
  if (!ctx) {
    redirect("/firms/request-account");
  }
  if (ctx.firm.status === "suspended") {
    redirect("/firm/suspended");
  }
  return ctx;
}

/**
 * Owner-or-manager gate. Used on settings + member-management
 * pages. Preparers + reviewers redirect back to the cockpit.
 */
export async function requireFirmAdmin(): Promise<FirmContext> {
  const ctx = await requireFirmContext();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "manager") {
    redirect("/firm");
  }
  return ctx;
}
