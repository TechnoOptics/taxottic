import Link from "next/link";
import Image from "next/image";

type WordmarkProps = {
  href?: string;
  size?: "sm" | "md" | "lg";
  tone?: "forest" | "cream";
};

const sizeMap = {
  sm: 28,
  md: 34,
  lg: 42,
};

// Aspect ratios of the two pre-rendered lockups (full icon + "TAXOTTIC"
// text together as one image - no live text).
//   /brand/wordmark-white.png  → 2266 × 256  → 8.85
//   /brand/full-logo.png       → 1600 × 234  → 6.84
// The two source files are designed differently by the brand team, so we
// keep their natural proportions rather than forcing one to match the
// other.
const ASPECT = {
  white: 2266 / 256,
  forest: 1600 / 234,
};

// Wordmark IS the home link. It renders its own <a> (via next/link), so it
// must never be wrapped in another <Link>/<a> by a caller: nested anchors are
// invalid HTML, the parser closes the outer one early, and React throws a
// hydration error (#418 in production) on every page that does it. Nineteen
// page headers did exactly that before this was consolidated here, so the
// eslint rule in eslint.config.mjs now fails the build on `<Link><Wordmark/>`.
// Pass `href` to retarget it (the AppHeader points it at /dashboard).
export function Wordmark({
  href = "/",
  size = "md",
  tone = "forest",
}: WordmarkProps) {
  const height = sizeMap[size];
  const src =
    tone === "cream" ? "/brand/wordmark-white.png" : "/brand/full-logo.png";
  const width = Math.round(height * ASPECT[tone === "cream" ? "white" : "forest"]);

  return (
    <Link
      href={href}
      // The wrappers this replaced announced "Taxottic home"; the wordmark's
      // own link announced "Taxottic". Keep the more descriptive of the two so
      // the single remaining link still says where it goes. This label wins
      // over the <Image alt> below for the accessible name; the alt stays for
      // the images-off / broken-image case.
      aria-label="Taxottic home"
      // min-w-0 lets the wordmark shrink when its flex parent (e.g. the
      // AppHeader) is squeezed on very narrow viewports (<300px foldables).
      className="inline-flex items-center select-none min-w-0"
    >
      <Image
        src={src}
        alt="Taxottic"
        width={width}
        height={height}
        priority
        // h-auto + max-w-full keeps aspect ratio while letting the rendered
        // width shrink below `width` when the container is narrower.
        style={{ height: "auto", maxWidth: "100%" }}
      />
    </Link>
  );
}
