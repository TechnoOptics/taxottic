import Link from "next/link";
import { Wordmark } from "./Wordmark";

type AppHeaderProps = {
  email?: string;
  bellaCompanyId?: string;
};

export function AppHeader({ email, bellaCompanyId }: AppHeaderProps) {
  const bellaHref = bellaCompanyId
    ? `/bella?company=${bellaCompanyId}`
    : "/bella";
  return (
    <header className="header-glow-line relative">
      <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
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
          <Link
            href={bellaHref}
            className="inline-flex items-center gap-1.5 text-forest-800 hover:text-forest-600"
          >
            <span className="gold-shine font-medium">Ask Bella</span>
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
  );
}
