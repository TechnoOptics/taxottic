import Link from "next/link";

/** `id` is the row's own anchor, so a list entry stays addressable (/changelog#...). */
export type LedgerItem = { href: string; title: string; blurb?: string; date?: string; figure?: string; tag?: string; id?: string };

/** Spec 4.2: card lists become ledger lists. The title is the link. */
export function LedgerList({ items, ariaLabel }: { items: LedgerItem[]; ariaLabel: string }) {
  return (
    <ul className="ledger-list" aria-label={ariaLabel}>
      {items.map((it) => (
        <li key={it.href} id={it.id} className="ledger-list-row">
          <Link href={it.href} className="ledger-list-link">
            <span className="ledger-list-main">
              <span className="ledger-list-title">{it.title}</span>
              {it.blurb ? <span className="ledger-list-blurb">{it.blurb}</span> : null}
            </span>
            {it.date || it.figure || it.tag ? (
              <span className="ledger-list-aside">
                {it.date ? <span className="figure">{it.date}</span> : null}
                {it.figure ? <span className="figure">{it.figure}</span> : null}
                {it.tag ? <span className="mono-label">{it.tag}</span> : null}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
