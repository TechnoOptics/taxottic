import Link from "next/link";

/**
 * Floating "Ask Bella" button. Fixed to the bottom-right of the viewport on
 * every authed page. Honors safe-area-inset-bottom on iOS so it doesn't sit
 * under the home indicator when the app is installed as a PWA.
 */
export function BellaFAB({ companyId }: { companyId?: string }) {
  const href = companyId ? `/bella?company=${companyId}` : "/bella";
  return (
    <Link
      href={href}
      aria-label="Ask Bella"
      title="Ask Bella"
      className="fixed z-30 right-4 sm:right-6 bg-forest-800 hover:bg-forest-700 active:translate-y-[1px] text-cream rounded-full size-14 sm:size-16 grid place-items-center shadow-lg shadow-forest-900/30 transition-colors"
      style={{
        bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <span className="display gold-shine text-2xl sm:text-3xl font-semibold leading-none">
        B
      </span>
    </Link>
  );
}
