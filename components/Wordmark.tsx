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

export function Wordmark({
  href = "/",
  size = "md",
  tone = "forest",
}: WordmarkProps) {
  const color =
    tone === "cream" ? "text-[var(--color-cream)]" : "text-forest-800";
  const { text, icon } = sizeMap[size];
  return (
    <Link
      href={href}
      className={`wordmark ${text} ${color} inline-flex items-center gap-2 select-none`}
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
