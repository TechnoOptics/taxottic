/**
 * Firm portal layout.
 *
 * Exists for ONE reason: to opt the firm portal out of the Instrument
 * skin that app/layout.tsx applies at <body>.
 *
 * The redesign on 2026-08-16 was scoped to the marketing page and the
 * employee portal. Applying it at the root and opting two portals out is
 * two edits; scoping it per page would have been eighty-six, because the
 * portal pages each render AppHeader and share no layout. The trade is
 * that /firm and /admin now have to say which look they use, which is an
 * improvement: it is greppable, and adopting the skin later becomes a
 * deletion rather than an eighty-six-file change.
 *
 * `.skin-scope` is `display: contents`, so this wrapper generates no box
 * and cannot shift the layout. Custom properties still inherit through
 * it, which is the whole mechanism.
 *
 * Deliberately does NOT add access control. Firm authorisation lives in
 * requireFirmContext() at each page and action, and adding a second,
 * weaker gate here would invite someone to trust it.
 */
export default function FirmLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-skin="classic" className="skin-scope">
      {children}
    </div>
  );
}
