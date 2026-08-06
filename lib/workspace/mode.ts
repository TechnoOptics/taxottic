/**
 * Workspace mode: which side of the app the user last chose to work on.
 *
 * The app has two workspaces, the personal (individual 1040) hub under
 * /personal/* plus /dashboard, and the business side under /c/[publicId]/*
 * plus /mileage. Until now "which mode am I in" was derived purely from the
 * URL inside LeftRail and never stored, so every landing on /dashboard, which
 * is where sign-in, the wordmark, and opening the phone app all put you, reset
 * the rail to Personal. Business owners had to re-pick Business constantly.
 *
 * This module holds the whole decision as pure functions so it can be tested
 * without Next or Supabase. The stored value lives on profiles.workspace_mode
 * (nullable, so it follows the user across the phone app and the web portal).
 *
 * Design notes that are load-bearing, see
 * docs/superpowers/specs/2026-08-06-remember-workspace-mode-design.md:
 *
 *   - NULL means "never chosen" and must behave exactly like today (land on
 *     /dashboard). A user who has not picked has nothing to remember, and
 *     guessing a landing page for them is a change nobody asked for.
 *   - Only "business" ever causes a redirect. /dashboard already IS the
 *     personal hub, so "personal" only needs to stop the business redirect.
 *     That asymmetry is what makes it structurally impossible for this feature
 *     to render a personal surface for someone who was not already going
 *     there, which is what protects the personal/business separation.
 *   - The redirect target is resolved from VALIDATED memberships only. A user
 *     with no company can therefore never be sent to a business surface.
 */

export type WorkspaceMode = "personal" | "business";

const MODES = new Set<string>(["personal", "business"]);

/**
 * Narrow an untrusted column value to a WorkspaceMode.
 *
 * Anything unrecognized (a value written by a future version, a hand-edited
 * row, a wrong type) degrades to null, which means "never chosen", which means
 * today's behavior. A bad row must never break the dashboard.
 */
export function parseWorkspaceMode(raw: unknown): WorkspaceMode | null {
  if (typeof raw !== "string") return null;
  return MODES.has(raw) ? (raw as WorkspaceMode) : null;
}

/**
 * The mode a pathname *declares*, or null when the route is mode-ambiguous.
 *
 * Used to keep the stored mode in step with deep links: if a push
 * notification drops the user into a business surface and they keep working
 * there, the next app open should land on business.
 *
 * `/dashboard` returns null deliberately. It is the one genuinely ambiguous
 * route and the one this feature exists to fix; if it counted as a personal
 * signal it would overwrite a remembered "business" the instant the user
 * landed, destroying the value on the very screen it is meant to restore.
 *
 * Shared routes that belong to neither side (/goals, /settings, /billing) are
 * ambiguous too, so passing through them leaves the stored mode alone.
 *
 * This mirrors LeftRail's own `onBusiness` derivation. Segment-boundary
 * matching (not bare `startsWith`) keeps /companies/new and /calculators from
 * being misread as /c/... and personal routes respectively.
 */
export function modeForPathname(pathname: string | null): WorkspaceMode | null {
  if (!pathname) return null;
  if (pathname === "/c" || pathname.startsWith("/c/")) return "business";
  // Mileage is a top-level route but is business-only, same rule LeftRail uses.
  if (pathname === "/mileage" || pathname.startsWith("/mileage/")) {
    return "business";
  }
  if (pathname === "/personal" || pathname.startsWith("/personal/")) {
    return "personal";
  }
  return null;
}

export type LandingCompany = {
  /** profiles.active_company_id is compared against this. */
  id: string;
  /** The /c/[publicId] segment. */
  publicId: string;
};

export type DashboardLandingInput = {
  /** profiles.workspace_mode, already parsed. */
  storedMode: WorkspaceMode | null;
  /** The user's VALIDATED memberships. An empty list means no business. */
  companies: readonly LandingCompany[];
  /** profiles.active_company_id, which may be stale. */
  activeCompanyId: string | null;
};

export type DashboardLanding = {
  /** Where /dashboard should send the user, or null to render normally. */
  redirectTo: string | null;
  /**
   * True when the stored mode is business but the user has no company left,
   * so the caller should reset the column to NULL and stop trying.
   */
  clearStoredMode: boolean;
};

/**
 * Decide what /dashboard should do for this user.
 *
 * Returns no redirect in every case except "the user explicitly chose business
 * and still belongs to at least one company".
 */
export function resolveDashboardLanding(
  input: DashboardLandingInput,
): DashboardLanding {
  const { storedMode, companies, activeCompanyId } = input;

  // Never chosen, or chose personal: /dashboard is already right.
  if (storedMode !== "business") {
    return { redirectTo: null, clearStoredMode: false };
  }

  // Business was chosen, but the user has no company any more (they left, were
  // removed, or deleted it). There is nothing to restore to, so stay put and
  // clear the stale preference rather than stranding them. This is the guard
  // that makes "business mode for a personal-only user" unreachable.
  if (companies.length === 0) {
    return { redirectTo: null, clearStoredMode: true };
  }

  // Prefer the company they were last looking at, but only if they are still a
  // member of it, otherwise fall back to their first membership. Same "never
  // trust a stale active_company_id" rule AppHeader and the watch snapshot use.
  const remembered =
    activeCompanyId == null
      ? null
      : (companies.find((c) => c.id === activeCompanyId) ?? null);
  const target = remembered ?? companies[0];

  return {
    redirectTo: `/c/${target.publicId}/forecast`,
    clearStoredMode: false,
  };
}
