import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/app-stores";

/**
 * "Download on the App Store" + "Get it on Google Play" badge links.
 * Reusable in the footer and the download banner. Monochrome navy pills with
 * white marks so the pair reads as one designed set that matches the brand,
 * rather than two mismatched official artworks. Server-renderable (plain
 * anchors), so crawlers see the store links in the HTML.
 */
export function AppStoreBadges({ className = "" }: { className?: string }) {
  return (
    <div className={"flex flex-wrap items-center gap-3 " + className}>
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Download Taxottic on the App Store"
        className="inline-flex items-center gap-2.5 rounded-xl bg-forest-900 px-4 py-2 text-cream hover:bg-forest-800 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.05 12.04c-.03-3.04 2.49-4.5 2.6-4.57-1.42-2.07-3.62-2.36-4.4-2.39-1.87-.19-3.65 1.1-4.6 1.1-.95 0-2.42-1.07-3.97-1.04-2.04.03-3.94 1.19-4.99 3.02-2.13 3.69-.54 9.13 1.52 12.13 1.01 1.47 2.21 3.12 3.78 3.06 1.52-.06 2.09-.99 3.92-.99 1.83 0 2.36.99 3.97.96 1.65-.03 2.68-1.49 3.68-2.97 1.17-1.71 1.64-3.36 1.66-3.45-.04-.02-3.18-1.22-3.21-4.85zM14.06 3.51c.83-1 1.39-2.4 1.23-3.79-1.19.05-2.63.79-3.49 1.78-.77.88-1.45 2.29-1.27 3.66 1.33.1 2.69-.67 3.53-1.65z" />
        </svg>
        <span className="leading-tight">
          <span className="block text-[9px] uppercase tracking-wide opacity-80">
            Download on the
          </span>
          <span className="block text-[15px] font-semibold -mt-0.5">
            App Store
          </span>
        </span>
      </a>

      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Get Taxottic on Google Play"
        className="inline-flex items-center gap-2.5 rounded-xl bg-forest-900 px-4 py-2 text-cream hover:bg-forest-800 transition-colors"
      >
        <svg width="18" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {/* Simplified play triangle. */}
          <path d="M4 2.6v18.8c0 .5.5.8.9.6l15.5-9.4c.4-.2.4-.8 0-1L4.9 2A.5.5 0 0 0 4 2.6z" />
        </svg>
        <span className="leading-tight">
          <span className="block text-[9px] uppercase tracking-wide opacity-80">
            Get it on
          </span>
          <span className="block text-[15px] font-semibold -mt-0.5">
            Google Play
          </span>
        </span>
      </a>
    </div>
  );
}
