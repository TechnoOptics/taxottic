import { Wordmark } from "./Wordmark";
import { BellaFAB } from "./BellaFAB";
import { UserMenu } from "./UserMenu";
import { GdprBanner } from "./GdprBanner";
import { FeedbackButton } from "./FeedbackButton";
import { HeaderScrollHider } from "./HeaderScrollHider";
import { createClient } from "@/lib/supabase/server";
import { recordGdprConsent } from "@/app/actions/consent";
import { submitFeedback } from "@/app/actions/feedback";
import { getActiveFeatureGates } from "@/lib/plans/usage";

type AppHeaderProps = {
  email?: string;
  bellaCompanyId?: string;
  // Reserved for future use; kept on the prop signature so existing
  // callers don't break. The capture deterrent stack was pulled out
  // after a demo regression - consider re-introducing only when we
  // can scope it more carefully (e.g., opt-in per page).
  allowPrint?: boolean;
};

export async function AppHeader({
  email,
  bellaCompanyId,
  allowPrint: _allowPrint = false,
}: AppHeaderProps) {
  // Pull profile for avatar + display name + GDPR state.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let fullName: string | null = null;
  let avatarUrl: string | null = null;
  let needsConsent = false;
  let bellaEnabled = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, avatar_url, gdpr_consented_at")
      .eq("id", user.id)
      .maybeSingle();
    fullName = profile?.full_name ?? null;
    avatarUrl = profile?.avatar_url ?? null;
    needsConsent = !profile?.gdpr_consented_at;
    const { gates } = await getActiveFeatureGates(supabase, user.id);
    bellaEnabled = gates.bella;
  }

  return (
    <>
      <header
        className="app-header app-header-shrinkable fixed top-0 left-0 right-0 z-20"
        style={{
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div
          className="app-header-row max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3 relative"
          style={{
            paddingTop: "calc(0.625rem + env(safe-area-inset-top, 0px))",
            paddingBottom: "0.625rem",
          }}
        >
          <Wordmark href="/dashboard" size="sm" tone="cream" />
          <UserMenu
            email={email ?? null}
            fullName={fullName}
            avatarUrl={avatarUrl}
          />
        </div>
      </header>
      {/* Spacer matches the header's full-size height so content
          never slides under the bar at the top of the page. */}
      <div
        aria-hidden="true"
        className="app-header-spacer"
        style={{
          height:
            "calc(0.625rem + env(safe-area-inset-top, 0px) + 0.625rem + 2.25rem)",
        }}
      />
      {/* Auto-shrinks the header on scroll on mobile (CSS-only, no
          JS animation - we just toggle a body class). */}
      <HeaderScrollHider />
      {/* Bella: Pro-only on the customer side. We still render the
          FAB for signed-in users so they discover the feature, but
          free-plan users hit a paywall card when they open the panel
          instead of running up Anthropic costs. */}
      {user ? (
        <BellaFAB companyId={bellaCompanyId} enabled={bellaEnabled} />
      ) : null}
      <FeedbackButton submitAction={submitFeedback} />
      {needsConsent ? <GdprBanner acceptAction={recordGdprConsent} /> : null}
    </>
  );
}
