"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";

const PLATFORMS = new Set(["user", "enterprise", "hq"]);

// Each portal now lives on its own real subdomain. The portal
// switcher hands off across origins, so the redirect target has to be
// an absolute URL — Next.js's `redirect()` issues a 303 to whatever
// you pass it, and the browser follows cross-origin redirects with a
// fresh request that re-runs the destination host's middleware.
//
// Hosts (May 2026 — three-portal split):
//   - taxottic.com               → consumer app
//   - hq.taxottic.com            → super-admin overview
//   - enterprise.taxottic.com    → firm-operator console
//
// In local dev (NEXT_PUBLIC_SITE_ORIGIN unset / pointing at
// localhost), we degrade gracefully to path-only redirects so the
// switcher still works without subdomain wildcards. The DNS / Vercel
// runbook for the three subdomains lives in
// docs/three-portal-runbook.md.
const SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://taxottic.com"
).replace(/\/$/, "");

// Strip any leading "https://" / "http://" and any path so we can
// build sibling subdomain hosts off the production origin without
// hardcoding "taxottic.com" twice.
const SITE_HOST = SITE_ORIGIN.replace(/^https?:\/\//, "").split("/")[0];
const SITE_PROTOCOL = SITE_ORIGIN.startsWith("http://") ? "http" : "https";
const IS_LOCALHOST = /^(localhost|127\.0\.0\.1)/i.test(SITE_HOST);

function siblingSubdomainOrigin(prefix: string): string {
  // Local dev keeps everything on one origin; subdomain routing is a
  // production-only thing because it needs real DNS.
  if (IS_LOCALHOST) return SITE_ORIGIN;
  // Build "<prefix>.<root>" — e.g. siblingSubdomainOrigin("hq") →
  // "https://hq.taxottic.com" given SITE_HOST=taxottic.com.
  return `${SITE_PROTOCOL}://${prefix}.${SITE_HOST}`;
}

// Subdomain-live flags. Each portal's subdomain needs real DNS, a
// Vercel domain, and a Supabase OAuth redirect URL registered before
// the switcher can safely point at it (see
// docs/three-portal-runbook.md). Until those are wired, falling back
// to the internal path on the consumer host keeps the portal switcher
// functional instead of strand-ing users on DNS_PROBE_FINISHED_NXDOMAIN.
//
// Flip these to "true" in Vercel env after the subdomain is live:
//   NEXT_PUBLIC_HQ_HOST_LIVE         → defaults true (hq has been live)
//   NEXT_PUBLIC_ENTERPRISE_HOST_LIVE → defaults false (added May 2026)
const HQ_HOST_LIVE = process.env.NEXT_PUBLIC_HQ_HOST_LIVE !== "false";
const ENTERPRISE_HOST_LIVE =
  process.env.NEXT_PUBLIC_ENTERPRISE_HOST_LIVE === "true";

const PLATFORM_LANDING: Record<"user" | "enterprise" | "hq", string> = {
  user: `${SITE_ORIGIN}/dashboard`,
  // Enterprise — once the subdomain is live, root path on
  // enterprise.taxottic.com; the middleware rewrites "/" to
  // "/admin/firms" on that host. Until then (default), fall back to
  // /admin/firms on the consumer host so the click does SOMETHING
  // instead of failing with DNS_PROBE_FINISHED_NXDOMAIN.
  enterprise:
    IS_LOCALHOST || !ENTERPRISE_HOST_LIVE
      ? `${SITE_ORIGIN}/admin/firms`
      : `${siblingSubdomainOrigin("enterprise")}/`,
  // HQ subdomain — root path; middleware rewrites "/" to "/admin".
  // HQ has been live since the original three-portal architecture, but
  // we still feature-gate via NEXT_PUBLIC_HQ_HOST_LIVE so a future
  // rollback is one env-var flip away.
  hq:
    IS_LOCALHOST || !HQ_HOST_LIVE
      ? `${SITE_ORIGIN}/admin`
      : `${siblingSubdomainOrigin("hq")}/`,
};

/**
 * Switch the active platform mode for the current user (super-admins
 * only). Saves the selection on profiles.active_platform and
 * redirects (cross-subdomain in production) to the platform's
 * landing page.
 */
export async function setActivePlatform(formData: FormData) {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const platform = String(formData.get("platform") ?? "user") as
    | "user"
    | "enterprise"
    | "hq";
  if (!PLATFORMS.has(platform)) {
    throw new Error("Invalid platform");
  }
  // Only super-admins can switch to non-user platforms. Regular users
  // can technically pick "user" but the toggle is a no-op for them.
  const { data: superAdmin } = await supabase.rpc("is_super_admin");
  if (!superAdmin && platform !== "user") {
    throw new Error("Forbidden");
  }
  await admin
    .from("profiles")
    .update({ active_platform: platform })
    .eq("id", user.id);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirect(PLATFORM_LANDING[platform]);
}
