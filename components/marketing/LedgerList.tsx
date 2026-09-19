import Link from "next/link";

/**
 * `id` is the row's own anchor, so a list entry stays addressable
 * (/changelog#...). `dateTime` is the machine-readable form of `date`:
 * pass it and the row renders a real <time>, so a release-notes page
 * still publishes its dates to anything that parses them.
 *
 * `href` is optional, and a row without one is not a link. The changelog
 * is the case that forced it: every row was an <a href="#x"> sitting
 * inside <li id="x">, a link to the element containing it, so clicking
 * or tabbing a row did nothing a reader could see. Before this list
 * existed those entries were static <article>s. The shape was not a
 * decision, it was this type requiring an href.
 */
export type LedgerItem = {
  /** Omit for a row that is a record, not a destination. */
  href?: string;
  title: string;
  blurb?: string;
  date?: string;
  dateTime?: string;
  figure?: string;
  tag?: string;
  id?: string;
};

/** Spec 4.2: card lists become ledger lists. The title is the link. */
export function LedgerList({ items, ariaLabel }: { items: LedgerItem[]; ariaLabel: string }) {
  return (
    <ul className="ledger-list" aria-label={ariaLabel}>
      {items.map((it) => {
        const body = (
          <>
            <span className="ledger-list-main">
              <span className="ledger-list-title">{it.title}</span>
              {it.blurb ? <span className="ledger-list-blurb">{it.blurb}</span> : null}
            </span>
            {it.date || it.figure || it.tag ? (
              <span className="ledger-list-aside">
                {it.date ? (
                  it.dateTime ? (
                    <time dateTime={it.dateTime} className="figure">{it.date}</time>
                  ) : (
                    <span className="figure">{it.date}</span>
                  )
                ) : null}
                {it.figure ? <span className="figure">{it.figure}</span> : null}
                {it.tag ? <span className="mono-label">{it.tag}</span> : null}
              </span>
            ) : null}
          </>
        );
        return (
          // The id stays on the <li> either way, so /changelog#... lands
          // on the row whether or not the row is a link.
          <li key={it.id ?? it.href ?? it.title} id={it.id} className="ledger-list-row">
            {it.href ? (
              <Link href={it.href} className="ledger-list-link">
                {body}
              </Link>
            ) : (
              // The geometry of .ledger-list-link (app/globals.css), as
              // utilities: flex row, 16px gap, 44px floor, 14px padding
              // top and bottom. Not the class itself, because the class
              // also underlines the title on hover, and a row that
              // underlines under the cursor and then does nothing is the
              // same lie as the self-link it replaces. The component
              // test measures both rows at 344 and 1280, so the two
              // paths cannot drift apart unseen.
              <div className="flex items-start justify-between gap-4 min-h-11 py-3.5">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
