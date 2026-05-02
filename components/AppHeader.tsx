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
  // Where the wordmark links to. Defaults to /dashboard for the
  // customer app; admin pages on hq.taxottic.com pass "/" so the
  // wordmark goes to the admin home (which middleware rewrites to
  // /admin internally).
  homeHref?: string;
  // Reserved for future use; kept on the prop signature so existing
  // callers don't break. The capture deterrent stack was pulled out
  // after a demo regression - consider re-introducing only when we
  // can scope it more carefully (e.g., opt-in per page).
  allowPrint?: boolean;
};

export async function AppHeader({
  email,
  bellaCompanyId,
  homeHref = "/dashboard",
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
          <Wordmark href={homeHref} size="sm" tone="cream" />
          <UserMenu
            email={email ?? null}
            fullName={fullName}
            avatarUrl={avatarUrl}
            adminMode={homeHref === "/"}
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
      {/* Bella + feedback are customer-app surfaces. Hide them on admin
          pages (hq.taxottic.com) so the super-admin view stays focused
          and we don't spend Anthropic tokens from the ops console. */}
      {user && homeHref !== "/" ? (
        <BellaFAB companyId={bellaCompanyId} enabled={bellaEnabled} />
      ) : null}
      {homeHref !== "/" ? (
        <FeedbackButton submitAction={submitFeedback} />
      ) : null}
      {needsConsent ? <GdprBanner acceptAction={recordGdprConsent} /> : null}
    </>
  );
}
