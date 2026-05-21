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

// SAME-ORIGIN ON PURPOSE. The portals are the same codebase served
// under /admin/**; the pretty `hq.` / `enterprise.` subdomains were a
// cosmetic split. A cross-origin redirect breaks the mobile app: the
// Capacitor WebView is pinned to taxottic.com, so a 303 to
// enterprise.taxottic.com gets punted to the SYSTEM BROWSER and the
// user is ejected from the app (signed out, on a marketing page).
// Routing every portal same-origin keeps the user inside the app on
// every binary, for every portal, with zero cross-origin hop — using
// the exact `/admin` + `/admin/firms` paths the code already treats
// as the canonical fallback. The subdomains still resolve if visited
// directly on the web. (HOST_LIVE flags / siblingSubdomainOrigin kept
// referenced below so the env contract + dev helper don't go stale.)
void HQ_HOST_LIVE;
void ENTERPRISE_HOST_LIVE;
void siblingSubdomainOrigin;
const PLATFORM_LANDING: Record<"user" | "enterprise" | "hq", string> = {
  user: `${SITE_ORIGIN}/dashboard`,
  enterprise: `${SITE_ORIGIN}/admin/firms`,
  hq: `${SITE_ORIGIN}/admin`,
};

/**
 * Revoke a paired watch. Soft-delete via revoked_at + null out the
 * token_hash so the bearer is dead immediately (snapshot calls hit
 * the auth lookup that ignores revoked rows). Service-role here
 * because watch_devices RLS is policy-less by design; we re-check
 * ownership server-side instead.
 */
export async function revokeWatchDevice(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const deviceId = String(formData.get("deviceId") ?? "").trim();
  if (!deviceId) return;
  // Confirm the device belongs to this user before we touch it.
  const { data: row } = await admin
    .from("watch_devices")
    .select("id, user_id")
    .eq("id", deviceId)
    .maybeSingle();
  if (!row || row.user_id !== user.id) return;
  await admin
    .from("watch_devices")
    .update({
      revoked_at: new Date().toISOString(),
      token_hash: null,
      pending_token: null,
    })
    .eq("id", deviceId);
  // Pairing UI moved to /settings/security (May 2026); /settings
  // still has a "find it under Security" shim, so revalidate both
  // so the count + list stay fresh wherever the user lands next.
  revalidatePath("/settings");
  revalidatePath("/settings/security");
}

/**
 * Toggle the Bella smart-search bar in the header. Default is off
 * (cleaner header for users who don't use Bella daily); flipping
 * this on adds the search input on lg+ widths.
 */
export async function setShowSmartSearch(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const next = String(formData.get("show_smart_search") ?? "") === "on";
  await admin
    .from("profiles")
    .update({ show_smart_search: next })
    .eq("id", user.id);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

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
