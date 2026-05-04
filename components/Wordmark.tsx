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
// text together as one image — no live text).
//   /brand/wordmark-white.png  → 2117 × 256  → 8.27
//   /brand/full-logo.png       → 4762 × 695  → 6.85
// The two source files are designed differently by the brand team, so we
// keep their natural proportions rather than forcing one to match the
// other.
const ASPECT = {
  white: 2117 / 256,
  forest: 4762 / 695,
};

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
      aria-label="Taxottic"
      className="inline-flex items-center select-none"
    >
      <Image
        src={src}
        alt="Taxottic"
        width={width}
        height={height}
        priority
        className="shrink-0"
      />
    </Link>
  );
}
