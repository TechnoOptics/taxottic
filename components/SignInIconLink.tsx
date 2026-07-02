import Link from "next/link";

/**
 * Compact "Sign in" affordance for the marketing header — a circular
 * icon button instead of the text link it replaces. On narrow phone
 * viewports "Sign in" as plain text next to the full wordmark had no
 * room to breathe and wrapped onto two lines ("Sign\nin"), reading as
 * squeezed. A fixed-size icon button never wraps regardless of
 * viewport width, and its size mirrors the authenticated app's own
 * avatar button (UserMenu) so signed-out and signed-in states feel
 * like the same product.
 */
export function SignInIconLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/login"
      aria-label="Sign in"
      title="Sign in"
      className={
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-cream/25 text-cream/85 transition-colors hover:border-cream/50 hover:bg-white/5 hover:text-cream " +
        className
      }
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
      </svg>
    </Link>
  );
}
