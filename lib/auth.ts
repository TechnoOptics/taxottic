import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Hosts that serve the super-admin shell. The middleware rewrites `/`
// to `/admin` on these. requireSuperAdmin uses this list to decide
// whether a "not super-admin, go home" redirect should be CROSS-ORIGIN
// (back to taxottic.com/dashboard) instead of relative — relative would
// get rewritten to /admin/dashboard on these hosts and 404 with the
// "personal day" page.
const ADMIN_HOSTS = new Set(["hq.taxottic.com", "enterprise.taxottic.com"]);

function consumerOrigin(): string {
  // Same resolution as app/settings/actions.ts so a follow-on
  // NEXT_PUBLIC_SITE_ORIGIN change flows everywhere. Defaults to
  // production so server-side redirects always have a place to send
  // users even if the env var is unset.
  return (
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://taxottic.com"
  ).replace(/\/$/, "");
}

async function currentHost(): Promise<string> {
  // Read the request host from Next.js's request-scoped headers().
  // Works inside Server Components, Server Actions, and Route Handlers.
  // We lower-case for the host comparison to match the middleware's
  // `host === HQ_HOST` style.
  const h = await headers();
  return (h.get("host") ?? "").toLowerCase();
}

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Enforce admin-applied block. Service-role read so RLS doesn't hide it.
  const admin = createServiceClient();
  const { data: prof } = await admin
    .from("profiles")
    .select("is_blocked")
    .eq("id", user.id)
    .maybeSingle();
  if (prof?.is_blocked) {
    await supabase.auth.signOut();
    redirect("/account/suspended");
  }

  return { supabase, user };
}

/**
 * Server-action helper. Returns the validated user plus a service-role
 * client. Necessary because @supabase/ssr's session cookies don't reliably
 * propagate to PostgREST queries from inside Next.js server actions on
 * production (auth.uid() returns NULL → RLS WITH CHECK fails).
 *
 * Safe pattern: trust user.id from the validated JWT, then perform writes
 * with the admin client (bypasses RLS). Always include user_id / created_by
 * = user.id in the inserted row. Never use admin to act on behalf of an
 * unvalidated identity.
 */
export async function requireUserWithAdmin() {
  const { supabase, user } = await requireUser();
  const admin = createServiceClient();
  return { supabase, user, admin };
}

export async function requireSuperAdmin() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase.rpc("is_super_admin");
  if (error || !data) {
    // If we're already on an admin host (hq.taxottic.com or
    // enterprise.taxottic.com), a bare `/dashboard` redirect would be
    // rewritten by middleware to `/admin/dashboard` — which doesn't
    // exist and renders the 404 "personal day" page. The May 2026
    // launch of the three-portal split caught this: super-admins who
    // landed here saw a 404 instead of being bounced back to the
    // consumer dashboard. Fix is to use an absolute URL so the
    // browser does a real cross-origin navigation and the destination
    // host's middleware handles the routing fresh.
    const host = await currentHost();
    if (ADMIN_HOSTS.has(host)) {
      redirect(`${consumerOrigin()}/dashboard`);
    }
    redirect("/dashboard");
  }
  return { supabase, user };
}

export type CompanyMembership = {
  company_id: string;
  role: "manager" | "member";
  // ISO timestamp the current user joined this company. Surfaced on
  // the dashboard ("Manager · added May 12, 2026") instead of the raw
  // public_id, per the May 2026 audit's P2 finding that the
  // database-style ID added engineering smell without value.
  joined_at: string;
  company: {
    id: string;
    public_id: string;
    name: string;
    logo_url: string | null;
  };
};

export async function getMyCompanies(): Promise<CompanyMembership[]> {
  const supabase = await createClient();
  // CRITICAL: explicit `.eq("user_id", uid)` filter.
  //
  // Without this, super-admins (whose RLS policy on company_members
  // says "you may read any row if you're a super-admin") would see
  // EVERY membership across every tenant — i.e., the consumer
  // dashboard would list other people's companies. That happened in
  // production for contact@technooptics.com on 2026-05-13.
  //
  // RLS still backstops here for regular users (they can't read
  // other tenants' rows even if we forgot this filter), but
  // getMyCompanies() means "MY companies, not all companies I can
  // technically see" — so the filter has to be explicit at the query
  // layer too. Belt-and-braces.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  // Filter out soft-deleted companies. Anything in the recycle bin
  // (deleted_at is not null) is visible only via /settings/recycle-bin
  // and the data-export endpoint — every other surface treats it as
  // gone. The PostgREST `companies.deleted_at.is.null` filter on the
  // joined row keeps the query in one round-trip.
  const { data } = await supabase
    .from("company_members")
    .select(
      "company_id, role, joined_at, company:companies!inner(id, public_id, name, logo_url, deleted_at)",
    )
    .eq("user_id", user.id)
    .is("company.deleted_at", null)
    .order("joined_at", { ascending: true });
  return (data ?? []) as unknown as CompanyMembership[];
}
