import Link from "next/link";

type WordmarkProps = {
  href?: string;
  size?: "sm" | "md" | "lg";
  tone?: "forest" | "cream";
};

const sizeMap = {
  sm: "text-xl",
  md: "text-2xl",
  lg: "text-3xl",
};

export function Wordmark({
  href = "/",
  size = "md",
  tone = "forest",
}: WordmarkProps) {
  const color =
    tone === "cream" ? "text-[var(--color-cream)]" : "text-forest-800";
  return (
    <Link
      href={href}
      className={`wordmark ${sizeMap[size]} ${color} inline-flex items-baseline gap-1 select-none`}
    >
      <span>Taxottic</span>
      <span className="gold-shine text-[0.6em] tracking-widest font-medium">
        BY TECHNO OPTICS
      </span>
    </Link>
  );
}
