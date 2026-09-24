import Link from "next/link";

export type Audience = "personal" | "business" | "firm";

const SEGMENTS: { id: Audience; label: string }[] = [
  { id: "personal", label: "For me" },
  { id: "business", label: "For my business" },
  { id: "firm", label: "For my firm" },
];

/**
 * The audience switch. Three audiences stay because pricing and guidance
 * follow them; the control is a quiet mono segmented switch on paper
 * rather than a pill on a navy band. Links, not buttons: the page is
 * server-rendered and the audience is a query parameter, so an old link
 * into "?audience=firm" keeps working.
 *
 * At 344px the three labels in 11px mono total about 290px, so nothing
 * wraps. Pinned by AudienceToggle.ct.spec.tsx.
 */
export function AudienceToggle({ audience }: { audience: Audience }) {
  return (
    <div className="audience-switch" role="tablist" aria-label="Choose audience">
      {SEGMENTS.map((s) => {
        const active = audience === s.id;
        return (
          <Link
            key={s.id}
            href={`/?audience=${s.id}`}
            scroll={false}
            role="tab"
            aria-selected={active}
            className={"audience-seg" + (active ? " is-on" : "")}
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}
