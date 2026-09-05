import Link from "next/link";
import { AppStoreBadges } from "@/components/AppStoreBadges";

export function MarketingFooter() {
  return (
    <footer className="border-t border-edge">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid gap-8 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted max-w-md leading-relaxed">
            Taxottic provides tax forecasting and educational guidance. It
            is not a substitute for advice from a licensed CPA or tax
            attorney.
          </p>
          <p className="mt-4 text-xs text-muted">
            {/* Ground-coloured chip: it reads as an outlined pill because its
                fill matches the page. `bg-cream` was baked to #fbf7e9 by
                `@theme inline` and stopped matching once the skin moved the
                ground, so it became a warm blob. The var() form tracks it. */}
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-[var(--accent-2)]"
              />
              {/* Exact attribution wording, do not reword: the string
                  "Powered by Techno Optics LLC" is the agreed studio
                  credit and is used verbatim in every footer. */}
              <span className="text-foreground font-medium">
                Powered by{" "}
                <a
                  href="https://technooptics.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-forest-900"
                >
                  Techno Optics LLC
                </a>
              </span>
            </span>
          </p>
          <div className="mt-5">
            <div className="mono-label mb-2">
              Get the app
            </div>
            <AppStoreBadges />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-muted sm:justify-self-end sm:text-right">
          {/* Two columns: "Product" (live, conversion-critical pages)
              and "Legal" (compliance surface). Surfaces every page the
              May 2026 audit said should be discoverable from the home
              page, pricing, help, changelog, example, plus the legal
              hub items. */}
          <div className="grid gap-2 sm:order-1">
            <span className="mono-label">
              Product
            </span>
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/example" className="hover:text-foreground">
              Example
            </Link>
            <Link href="/help" className="hover:text-foreground">
              Help
            </Link>
            <Link href="/guides" className="hover:text-foreground">
              Guides
            </Link>
            <Link href="/calculators" className="hover:text-foreground">
              Free calculators
            </Link>
            <Link href="/compare" className="hover:text-foreground">
              Compare
            </Link>
            <Link href="/changelog" className="hover:text-foreground">
              Changelog
            </Link>
            <Link href="/book?for=firm" className="hover:text-foreground">
              For firms
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
          </div>
          <div className="grid gap-2 sm:order-2">
            <span className="mono-label">
              Legal
            </span>
            <Link href="/legal" className="hover:text-foreground">
              Legal hub
            </Link>
            <Link href="/legal/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/legal/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link
              href="/legal/location-monitoring"
              className="hover:text-foreground"
            >
              Location tracking
            </Link>
            <Link href="/legal/security" className="hover:text-foreground">
              Security
            </Link>
            <Link
              href="/legal/subprocessors"
              className="hover:text-foreground"
            >
              Subprocessors
            </Link>
            <Link
              href="/legal/accessibility"
              className="hover:text-foreground"
            >
              Accessibility
            </Link>
            <Link href="/legal/dmca" className="hover:text-foreground">
              DMCA
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
