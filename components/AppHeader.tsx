import Link from "next/link";
import { Wordmark } from "./Wordmark";
import { BellaFAB } from "./BellaFAB";

type AppHeaderProps = {
  email?: string;
  bellaCompanyId?: string;
};

export function AppHeader({ email, bellaCompanyId }: AppHeaderProps) {
  return (
    <>
      <header
        className="header-glow-line sticky top-0 z-20 border-b border-forest-100/60"
        style={{
          backgroundColor: "rgba(251, 247, 233, 0.85)",
          backdropFilter: "saturate(140%) blur(10px)",
          WebkitBackdropFilter: "saturate(140%) blur(10px)",
        }}
      >
        <div
          className="max-w-6xl mx-auto px-6 flex items-center justify-between gap-4"
          style={{
            paddingTop: "calc(1.25rem + env(safe-area-inset-top, 0px))",
            paddingBottom: "1.25rem",
          }}
        >
          <Wordmark href="/dashboard" />
          <div className="flex items-center gap-3 sm:gap-5 text-sm">
            <Link
              href="/goals"
              className="hidden sm:inline text-ink-soft hover:text-forest-800"
            >
              Goals
            </Link>
            <Link
              href="/reminders"
              className="hidden sm:inline text-ink-soft hover:text-forest-800"
            >
              Reminders
            </Link>
            {email ? (
              <span className="hidden md:inline text-ink-soft">{email}</span>
            ) : null}
            <Link
              href="/billing"
              className="hidden sm:inline text-ink-soft hover:text-forest-800"
            >
              Billing
            </Link>
            <Link
              href="/settings/security"
              className="hidden sm:inline text-ink-soft hover:text-forest-800"
            >
              Settings
            </Link>
            <form action="/auth/signout" method="post">
              <button className="text-ink-soft hover:text-forest-800">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <BellaFAB companyId={bellaCompanyId} />
    </>
  );
}
