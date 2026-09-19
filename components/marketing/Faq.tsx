import { ChevronDownIcon } from "@/components/ui/Icons";

/**
 * One FAQ row: a hairline-ruled disclosure. Shared by /pricing and
 * /help so the two lists read as the same object; it used to be a
 * page-local copy on each, which is how /help ended up with open copy
 * and no control at all.
 *
 * The chevron is the only thing telling the reader the row opens: a
 * flex summary drops the native marker, so the indicator has to be
 * drawn. `.faq-row` rules the row; `.faq-summary` kills the marker and
 * turns the chevron when the row is open (app/globals.css).
 */
export function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="faq-row border-b border-edge py-3">
      <summary className="faq-summary min-h-11 flex items-center justify-between gap-3 cursor-pointer select-none font-medium text-[var(--foreground)]">
        <span>{q}</span>
        <ChevronDownIcon className="faq-chevron size-4 shrink-0" />
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}
