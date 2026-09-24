/* eslint-disable @next/next/no-img-element -- next/image would need an
   optimizer round-trip on a screen we already want to show in
   milliseconds, so the mark is served as a plain pre-sized file. */

/**
 * Global loading screen, shown by Next.js during any route segment
 * navigation or server-data resolution. The brief: "premium thinking"
 * feel, not a generic spinner.
 *
 * Visuals: full-bleed navy gradient with two soft, blurred radial
 * halos (gold + deeper navy) that give the impression of a blurred
 * screen depth. The icon mark sits centred and breathes, gentle
 * scale + opacity pulse with a gold drop-shadow that swells in time
 * with the scale, so it reads as a glow rather than a flashing dot.
 * Reduced-motion users get a still frame.
 *
 * Next.js looks for app/loading.tsx as the Suspense fallback for the
 * root segment; sub-routes can drop their own loading.tsx if they
 * want a different look, otherwise they inherit this one.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 grid place-items-center overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #2a3a5e 0%, #1d2843 50%, #121a2a 100%)",
      }}
    >
      {/* Soft depth halos behind the mark. These used to carry an
          additional `filter: blur(38px)` on top of the gradients' own
          fade-to-transparent stops, a real device (Galaxy Z Fold5)
          started rendering this whole screen as solid BLACK instead of
          navy, with the pulse animation still visibly driving repaints
          (confirmed via logcat: continuous WebView onDraw calls), which
          points at a WebView/GPU compositing bug with a large full-
          screen `filter: blur()` layer rather than a frozen/crashed
          page. Android's System WebView auto-updates independently of
          our own deploys, so this can regress with no code change on
          our end. The gradients already fade out smoothly via their
          own stops (`transparent 65%` / `70%`); dropping the extra blur
          removes the risky GPU filter entirely without losing the
          soft-glow look. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 45% at 50% 45%, rgba(213, 187, 126, 0.16), transparent 65%), radial-gradient(45% 40% at 70% 75%, rgba(42, 58, 94, 0.55), transparent 70%), radial-gradient(35% 30% at 25% 30%, rgba(29, 40, 67, 0.55), transparent 70%)",
        }}
      />

      <div className="relative grid place-items-center taxottic-pulse">
        {/*
          Pre-sized to 288px = 3x the 96px render box, which is the
          highest pixel density any shipping phone asks for.

          This used to point at /brand/icon-mark-cream.svg, which is not
          a vector: it is a 512x512 PNG base64-embedded in an SVG
          wrapper, 39,754 bytes on disk and 29,699 on the wire after
          brotli. Because app/loading.tsx is the root Suspense fallback,
          React emits this asset as <link rel="preload" as="image"> at
          the very top of every route's <head>, so it was the single
          highest-priority fetch of every cold start, and the native
          shell loads a REMOTE url so every cold start pays it. The
          pre-sized PNG is 16,313 bytes and is the same artwork.
        */}
        <img
          src="/brand/icon-mark-cream-288.png"
          alt=""
          width={96}
          height={96}
          draggable={false}
          className="select-none"
          style={{ width: 96, height: 96 }}
        />
      </div>

      <span className="sr-only">Loading…</span>

      <style>{`
        .taxottic-pulse {
          animation: taxottic-pulse 1700ms cubic-bezier(0.4, 0, 0.6, 1) infinite;
          will-change: transform, opacity, filter;
        }
        @keyframes taxottic-pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.86;
            filter: drop-shadow(0 0 14px rgba(213, 187, 126, 0.28));
          }
          50% {
            transform: scale(1.09);
            opacity: 1;
            filter: drop-shadow(0 0 28px rgba(242, 216, 150, 0.55));
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .taxottic-pulse {
            animation: none;
            filter: drop-shadow(0 0 18px rgba(213, 187, 126, 0.35));
          }
        }
      `}</style>
    </div>
  );
}
