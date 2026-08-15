import Link from "next/link";

/**
 * Primary navigation for the marketing header.
 *
 * Until now the header held a wordmark and a sign-in button and nothing
 * else, so Pricing, Guides and Calculators were reachable only from the
 * footer. That is fine for a visitor who scrolls to the bottom and poor
 * for everyone else, and it concentrates every internal link to the
 * money pages in one block at the end of the document.
 *
 * DESKTOP ONLY, and that is a measured constraint rather than a
 * preference. components/SignInIconLink.tsx exists because the words
 * "Sign in" could not fit beside the full wordmark on a phone without
 * wrapping to two lines; three more labels have no chance. Mobile keeps
 * the footer as its route to these pages.
 *
 * No JavaScript. These are server-rendered marketing pages with a
 * measured total blocking time of 0ms, and the current page is passed in
 * as a prop rather than read from usePathname precisely so this
 * component cannot become the thing that costs them that.
 */

type NavKey = "pricing" | "guides" | "calculators";

const ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: "pricing", href: "/pricing", label: "Pricing" },
  { key: "guides", href: "/guides", label: "Guides" },
  { key: "calculators", href: "/calculators", label: "Calculators" },
];

export function MarketingNav({
  current,
  className = "",
}: {
  /** Highlights the item for the page being viewed. Omit off-nav pages. */
  current?: NavKey;
  className?: string;
}) {
  return (
    <nav
      aria-label="Primary"
      className={"hidden md:flex items-center gap-7 " + className}
    >
      {ITEMS.map((item) => {
        const active = item.key === current;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              "group relative inline-flex items-center py-1 text-[0.9375rem] " +
              "font-medium tracking-[0.01em] transition-colors " +
              "focus-visible:outline-none focus-visible:ring-2 " +
              "focus-visible:ring-gold-400/70 focus-visible:ring-offset-2 " +
              "focus-visible:ring-offset-transparent rounded-sm " +
              (active ? "text-cream" : "text-cream/75 hover:text-cream")
            }
          >
            {item.label}
            {/*
              The indicator is the header's own gold hairline sweep,
              scaled down to the width of one label. Reusing the
              signature the header already has, rather than inventing a
              second accent to sit next to it, is the whole idea: on
              hover the sweep appears to echo beneath the item.
            */}
            <span
              aria-hidden="true"
              className={
                "pointer-events-none absolute left-0 right-0 -bottom-0.5 h-px " +
                "origin-center transition-transform duration-200 " +
                "motion-reduce:transition-none " +
                (active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100")
              }
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(213,187,126,0.55) 20%, rgba(242,216,150,0.95) 50%, rgba(213,187,126,0.55) 80%, transparent 100%)",
              }}
            />
          </Link>
        );
      })}
    </nav>
  );
}
