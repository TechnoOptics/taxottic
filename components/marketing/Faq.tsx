import { ChevronDownIcon } from "@/components/ui/Icons";

/**
 * One FAQ row: a hairline-ruled disclosure. Shared by /pricing and
 * /help so the two lists read as the same object; it used to be a
 * page-local copy on each, which is how /help ended up with open copy
 * and no control at all.
 *
 * The chevron is the only thing telling the reader the row opens: a
 * flex summary drops the native marker, so the indicator has to be
 * drawn.
 *
 * Two classes carry the shape, both in app/globals.css: `.faq-row`
 * sets the bottom hairline, `.faq-summary` sets the 44px floor, the
 * flex row and the alignment, kills the native marker and turns the
 * chevron when the row is open. The utilities that restated all of
 * that (`border-b border-edge`, `min-h-11 flex items-center`) are
 * gone: they computed to the same values, so they changed nothing and
 * left two places to read before knowing what a row is.
 */
export function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="faq-row py-3">
      <summary className="faq-summary justify-between gap-3 cursor-pointer select-none font-medium text-[var(--foreground)]">
        <span>{q}</span>
        <ChevronDownIcon className="faq-chevron size-4 shrink-0" />
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}
