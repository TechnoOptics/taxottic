import type { Plan } from "@/lib/plans/limits";

/**
 * Fixed bottom pill shown to a super-admin who has pinned their
 * effective plan to a lower tier via the profile-menu QA switcher. It's
 * a constant reminder that features are gated *by the preview*, not
 * broken, and a one-tap exit back to the full ('practice') experience.
 *
 * Rendered by AppHeader only when previewPlan is set and isn't already
 * the default 'practice' tier. Bottom-fixed so it never disturbs the
 * fixed header + spacer math up top.
 */
const PLAN_LABEL: Record<Plan, string> = {
  free: "Free",
  filer: "Filer",
  solo: "Solo",
  studio: "Studio",
  scale: "Scale",
  practice: "Practice",
};

export function PlanPreviewBanner({
  plan,
  resetAction,
}: {
  plan: Plan;
  resetAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <div
      className="fixed inset-x-0 z-40 flex justify-center px-4 pointer-events-none"
      style={{
        bottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-gold-300 bg-forest-900 text-cream shadow-2xl pl-4 pr-1.5 py-1.5 max-w-[calc(100vw-2rem)]">
        <span className="text-[11px] uppercase tracking-[0.18em] text-gold-300 font-medium shrink-0">
          QA preview
        </span>
        <span className="text-sm truncate">
          Viewing the <strong>{PLAN_LABEL[plan]}</strong> plan
        </span>
        <form action={resetAction} className="shrink-0">
          {/* Empty value clears the override → back to full 'practice'. */}
          <input type="hidden" name="plan" value="" />
          <button
            type="submit"
            className="rounded-full bg-cream/15 hover:bg-cream/25 px-3 py-1.5 text-sm font-medium transition-colors"
          >
            Exit
          </button>
        </form>
      </div>
    </div>
  );
}
