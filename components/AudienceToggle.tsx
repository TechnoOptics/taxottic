import Link from "next/link";

export type Audience = "personal" | "business" | "firm";

const SEGMENTS: { id: Audience; label: string }[] = [
  { id: "personal", label: "For me" },
  { id: "business", label: "For my business" },
  { id: "firm", label: "For my firm" },
];

/**
 * The audience switch at the top of the marketing home page.
 *
 * Below `sm` it is a full-width, three-column control with 12px labels and
 * no wrapping. Before that it was the same inline pill at every width, and
 * on a 344px or 375px phone every label broke onto two lines ("For / me",
 * "For my / business"), which is the first thing a visitor saw. Pinned by
 * AudienceToggle.ct.spec.tsx on the Fold cover screen.
 */
export function AudienceToggle({ audience }: { audience: Audience }) {
  return (
    <div
      className="flex w-full sm:inline-flex sm:w-auto p-1 rounded-full bg-white/8 border border-gold-300/20 backdrop-blur"
      role="tablist"
      aria-label="Choose audience"
    >
      {SEGMENTS.map((s) => {
        const active = audience === s.id;
        return (
          <Link
            key={s.id}
            href={`/?audience=${s.id}`}
            scroll={false}
            role="tab"
            aria-selected={active}
            className={
              "flex-1 sm:flex-none text-center whitespace-nowrap px-2 sm:px-5 py-2 rounded-full text-xs sm:text-sm font-medium transition-all " +
              (active
                ? "bg-cream text-forest-900 shadow"
                : "text-cream/80 hover:text-cream hover:bg-white/5")
            }
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}
