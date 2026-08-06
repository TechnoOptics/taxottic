"use server";

import { requireUserWithAdmin } from "@/lib/auth";
import { parseWorkspaceMode, type WorkspaceMode } from "@/lib/workspace/mode";

/**
 * Persist which workspace the user is on: "personal" (the individual 1040 hub)
 * or "business" (a company under /c/[publicId]). /dashboard reads it back to
 * restore the business side instead of always resetting to Personal. See
 * docs/superpowers/specs/2026-08-06-remember-workspace-mode-design.md.
 *
 * Called from LeftRail when the URL-derived mode disagrees with the stored
 * one, which covers both tapping the Personal/Business toggle (the toggle is a
 * plain link, so the new route is what reports the change) and following a
 * deep link into the other mode.
 *
 * Deliberately does NOT revalidate. Nothing on the page the user is currently
 * looking at depends on this column; it is only read on the next /dashboard
 * render. Revalidating here would churn the tree on every cross-mode
 * navigation for no visible benefit.
 *
 * Admin client because profiles.update is not RLS-permissive for the user's
 * own row, the same reason completeWelcomeTour and setActivePlatform use it.
 * The row written is always the authenticated user's own id, never a value
 * supplied by the caller.
 */
export async function setWorkspaceMode(mode: WorkspaceMode) {
  // Never trust the argument. An unrecognized value is dropped rather than
  // written, so the column can only ever hold a value the app understands.
  const parsed = parseWorkspaceMode(mode);
  if (!parsed) return;

  const { admin, user } = await requireUserWithAdmin();
  await admin
    .from("profiles")
    .update({ workspace_mode: parsed })
    .eq("id", user.id);
}

/**
 * Reset the remembered workspace to "never chosen".
 *
 * Used by /dashboard to self-heal: when the stored mode is "business" but the
 * user no longer belongs to any company (they left, were removed, or deleted
 * it) there is nothing to restore to, so the stale preference is cleared and
 * the app stops trying.
 */
export async function clearWorkspaceMode() {
  const { admin, user } = await requireUserWithAdmin();
  await admin
    .from("profiles")
    .update({ workspace_mode: null })
    .eq("id", user.id);
}
