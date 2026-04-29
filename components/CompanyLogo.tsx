/**
 * Display-only logo presenter. Shows the uploaded image when present,
 * otherwise falls back to a champagne-bordered monogram tile. Used in
 * the forecast hero, the dashboard cards, and the year-end print.
 *
 * Plain <img> instead of next/image so we don't need to add the
 * Supabase Storage host to next.config images domains for every
 * environment, and so the file prints cleanly without a wrapper that
 * breaks page-break behavior.
 */

type Props = {
  src: string | null;
  name: string;
  size?: number;
  className?: string;
  /** When true, drops the rounded background and uses a simple frame
   *  appropriate for print (PDF export). */
  print?: boolean;
};

export function CompanyLogo({
  src,
  name,
  size = 48,
  className = "",
  print = false,
}: Props) {
  const monogram = (name.trim().charAt(0) || "T").toUpperCase();
  const dim = { width: size, height: size };

  if (src) {
    return (
      <span
        style={dim}
        className={
          (print
            ? "inline-grid place-items-center bg-white "
            : "inline-grid place-items-center rounded-xl bg-white border border-forest-100 ") +
          "overflow-hidden shrink-0 " +
          className
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`${name} logo`}
          style={{ maxWidth: "100%", maxHeight: "100%" }}
          className="object-contain p-1.5"
        />
      </span>
    );
  }

  // Fallback monogram. Forest gradient with a thin gold rule under the
  // letter so an empty logo still feels intentional, not like a missing
  // asset.
  return (
    <span
      style={dim}
      className={
        (print
          ? "inline-grid place-items-center bg-white border border-forest-200 "
          : "inline-grid place-items-center rounded-xl shrink-0 ") +
        className
      }
    >
      <span
        className={
          "size-full grid place-items-center display text-forest-900 " +
          (print
            ? ""
            : "rounded-xl bg-gradient-to-br from-cream/80 to-gold-100/70 border border-forest-100")
        }
        style={{ fontSize: Math.max(14, Math.round(size * 0.5)) }}
        aria-hidden="true"
      >
        {monogram}
      </span>
    </span>
  );
}
