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

const PLATFORM_LANDING: Record<"user" | "enterprise" | "hq", string> = {
  user: `${SITE_ORIGIN}/dashboard`,
  // Enterprise subdomain — root path; the destination host's
  // middleware rewrites "/" to "/admin/firms" on enterprise.taxottic.com.
  // In local dev the rewrite doesn't trigger, so we send to the
  // internal /admin/firms directly.
  enterprise: IS_LOCALHOST
    ? `${SITE_ORIGIN}/admin/firms`
    : `${siblingSubdomainOrigin("enterprise")}/`,
  // HQ subdomain — root path; middleware rewrites "/" to "/admin".
  hq: IS_LOCALHOST
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
