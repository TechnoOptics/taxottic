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
            {/* The dot before the studio credit is a separator, not data.
                Brass in this grammar is spent on today's marker, the live
                figure and the marks inside a product screen (design spec,
                section 3), so a brass dot in the footer reads as a fourth
                claim on the eye for nothing. Ink at 45% instead. */}
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-[var(--foreground)] opacity-45"
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
                  className="inline-flex min-h-11 items-center underline hover:text-forest-900"
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

        <div className="grid grid-cols-2 gap-x-6 text-xs text-muted sm:justify-self-end sm:text-right">
          {/* Two columns: "Product" (live, conversion-critical pages)
              and "Legal" (compliance surface). Surfaces every page the
              May 2026 audit said should be discoverable from the home
              page, pricing, help, changelog, example, plus the legal
              hub items. */}
          <div className="grid sm:order-1 sm:justify-items-end">
            <span className="mono-label">
              Product
            </span>
            <Link href="/pricing" className="inline-flex min-h-11 items-center hover:text-foreground">
              Pricing
            </Link>
            <Link href="/example" className="inline-flex min-h-11 items-center hover:text-foreground">
              Example
            </Link>
            <Link href="/help" className="inline-flex min-h-11 items-center hover:text-foreground">
              Help
            </Link>
            <Link href="/guides" className="inline-flex min-h-11 items-center hover:text-foreground">
              Guides
            </Link>
            <Link href="/calculators" className="inline-flex min-h-11 items-center hover:text-foreground">
              Free calculators
            </Link>
            <Link href="/compare" className="inline-flex min-h-11 items-center hover:text-foreground">
              Compare
            </Link>
            <Link href="/changelog" className="inline-flex min-h-11 items-center hover:text-foreground">
              Changelog
            </Link>
            <Link href="/book?for=firm" className="inline-flex min-h-11 items-center hover:text-foreground">
              For firms
            </Link>
            <Link href="/login" className="inline-flex min-h-11 items-center hover:text-foreground">
              Sign in
            </Link>
          </div>
          <div className="grid sm:order-2 sm:justify-items-end">
            <span className="mono-label">
              Legal
            </span>
            <Link href="/legal" className="inline-flex min-h-11 items-center hover:text-foreground">
              Legal hub
            </Link>
            <Link href="/legal/privacy" className="inline-flex min-h-11 items-center hover:text-foreground">
              Privacy
            </Link>
            <Link href="/legal/terms" className="inline-flex min-h-11 items-center hover:text-foreground">
              Terms
            </Link>
            <Link
              href="/legal/location-monitoring"
              className="inline-flex min-h-11 items-center hover:text-foreground"
            >
              Location tracking
            </Link>
            <Link href="/legal/security" className="inline-flex min-h-11 items-center hover:text-foreground">
              Security
            </Link>
            <Link
              href="/legal/subprocessors"
              className="inline-flex min-h-11 items-center hover:text-foreground"
            >
              Subprocessors
            </Link>
            <Link
              href="/legal/accessibility"
              className="inline-flex min-h-11 items-center hover:text-foreground"
            >
              Accessibility
            </Link>
            <Link href="/legal/dmca" className="inline-flex min-h-11 items-center hover:text-foreground">
              DMCA
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
