import Link from "next/link";
import Image from "next/image";

type WordmarkProps = {
  href?: string;
  size?: "sm" | "md" | "lg";
  tone?: "forest" | "cream";
};

const sizeMap = {
  sm: { text: "text-xl", icon: 28 },
  md: { text: "text-2xl", icon: 34 },
  lg: { text: "text-3xl", icon: 42 },
};

// Aspect ratio of /brand/wordmark-white.png (2117 × 256).
const WORDMARK_ASPECT = 2117 / 256;

export function Wordmark({
  href = "/",
  size = "md",
  tone = "forest",
}: WordmarkProps) {
  const { text, icon } = sizeMap[size];

  // On dark surfaces (the AppHeader) we use the full white wordmark image
  // so the icon and "Taxottic" text share the same baseline + spacing as
  // the brand-supplied lockup. On cream surfaces we keep the icon-plus-
  // live-text composition because there's no forest version of the full
  // lockup yet, and live text scales crisper at small sizes.
  if (tone === "cream") {
    const width = Math.round(icon * WORDMARK_ASPECT);
    return (
      <Link
        href={href}
        aria-label="Taxottic"
        className="inline-flex items-center select-none"
      >
        <Image
          src="/brand/wordmark-white.png"
          alt="Taxottic"
          width={width}
          height={icon}
          priority
          className="shrink-0"
        />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`wordmark ${text} text-forest-800 inline-flex items-center gap-2 select-none`}
    >
      <Image
        src="/brand/wordmark-icon-512.png"
        alt=""
        width={icon}
        height={icon}
        priority
        className="shrink-0"
      />
      <span>Taxottic</span>
    </Link>
  );
}
