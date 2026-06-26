"use client";

import { useEffect, useState, useTransition } from "react";
import { rethrowIfRedirect } from "@/lib/next/redirect-error";

type Firm = {
  id: string;
  public_id: string;
  name: string;
  logo_url: string | null;
  accent_color: string | null;
  city: string | null;
  state_code: string | null;
  website: string | null;
};

type Props = {
  companyId: string;
  defaultTaxYear: number;
  searchAction: (q: string) => Promise<Firm[]>;
  requestAction: (formData: FormData) => Promise<void>;
  onClose: () => void;
};

const KIND_LABEL: Record<string, string> = {
  tax_prep: "Tax preparation",
  audit_support: "Audit / examination support",
  bookkeeping: "Bookkeeping",
  advisory: "Advisory",
};

/**
 * Search-and-select dialog for picking a tax preparer firm. The two
 * stages live in the same modal:
 *   1. Search active firms by name or public_id.
 *   2. After selecting one, choose tax year + kind + an optional note,
 *      then submit which sends the engagement request.
 */
export function FindFirmDialog({
  companyId,
  defaultTaxYear,
  searchAction,
  requestAction,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Firm[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Firm | null>(null);
  const [taxYear, setTaxYear] = useState(defaultTaxYear);
  const [kind, setKind] = useState<keyof typeof KIND_LABEL>("tax_prep");
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Live search debounced by 250ms. We also pre-load the empty query
  // so users see the directory on first open.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      searchAction(query)
        .then((firms) => setResults(firms))
        .catch((err) =>
          setSearchError(err instanceof Error ? err.message : "Search failed"),
        )
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, searchAction]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    setSubmitError(null);
    const fd = new FormData();
    fd.set("company_id", companyId);
    fd.set("firm_id", selected.id);
    fd.set("tax_year", String(taxYear));
    fd.set("kind", kind);
    if (note.trim()) fd.set("client_note", note.trim());
    startTransition(async () => {
      try {
        await requestAction(fd);
        onClose();
      } catch (err) {
        rethrowIfRedirect(err);
        setSubmitError(err instanceof Error ? err.message : "Request failed");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Find a tax preparer"
      className="fixed inset-0 z-50 grid place-items-center px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-forest-900/45 backdrop-blur-sm" />
      <div
        className="card relative w-full max-w-lg p-6 sm:p-7 max-h-[85vh] overflow-y-auto no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 size-8 rounded-full grid place-items-center text-ink-muted hover:bg-cream"
        >
          ×
        </button>

        {selected ? (
          <form onSubmit={onSubmit} className="grid gap-4">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-ink-soft hover:text-forest-900 self-start"
            >
              ← Pick a different firm
            </button>

            <div className="flex items-center gap-3">
              {selected.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.logo_url}
                  alt=""
                  className="size-12 rounded-xl border border-forest-100 bg-white object-contain p-1.5"
                />
              ) : (
                <span className="size-12 rounded-xl bg-cream/70 border border-forest-100 grid place-items-center display text-xl text-forest-900">
                  {selected.name.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <div className="display text-lg text-forest-900 truncate">
                  {selected.name}
                </div>
                <div className="text-xs text-ink-muted">
                  {selected.public_id}
                  {selected.city || selected.state_code
                    ? ` · ${[selected.city, selected.state_code].filter(Boolean).join(", ")}`
                    : ""}
                </div>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-forest-800">
                  Tax year
                </span>
                <input
                  type="number"
                  min={defaultTaxYear - 3}
                  max={defaultTaxYear + 1}
                  value={taxYear}
                  onChange={(e) => setTaxYear(Number(e.target.value))}
                  className="input"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-forest-800">
                  Service
                </span>
                <select
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as keyof typeof KIND_LABEL)
                  }
                  className="input"
                >
                  {Object.entries(KIND_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Note for the firm (optional)
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="input py-2"
                placeholder="A few words on what you'd like them to focus on. e.g. 'Filing Schedule C as sole prop, first year with home office.'"
              />
            </label>

            <p className="text-[11px] text-ink-muted leading-relaxed">
              Sending this gives <strong>{selected.name}</strong> a request
              to prepare your tax year {taxYear} return. They&apos;ll see your
              books only after they accept.
            </p>

            {submitError ? (
              <p className="text-sm text-red-700">{submitError}</p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="btn-ghost text-sm"
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary text-sm"
                disabled={pending}
              >
                {pending ? "Sending..." : "Send request"}
              </button>
            </div>
          </form>
        ) : (
          <div className="grid gap-3">
            <h2 className="display text-2xl text-forest-900">
              Find a tax preparer
            </h2>
            <p className="text-sm text-ink-soft leading-relaxed">
              Search the directory of accounting firms on Taxottic
              Enterprise. Pick one and we&apos;ll send them a request on your
              behalf - they&apos;ll review your engagement before getting any
              access to your books.
            </p>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by firm name"
              className="input"
            />
            {searchError ? (
              <p className="text-sm text-red-700">{searchError}</p>
            ) : null}
            <ul className="grid gap-1.5 max-h-72 overflow-y-auto no-scrollbar pr-1">
              {searching && results.length === 0 ? (
                <li className="text-xs text-ink-muted text-center py-4">
                  Searching...
                </li>
              ) : null}
              {results.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(f)}
                    className="w-full text-left flex items-center gap-3 rounded-lg border border-forest-100 hover:border-forest-300 px-3 py-2"
                  >
                    {f.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.logo_url}
                        alt=""
                        className="size-9 rounded-lg border border-forest-100 bg-white object-contain p-1"
                      />
                    ) : (
                      <span className="size-9 rounded-lg bg-cream/70 border border-forest-100 grid place-items-center text-sm font-semibold text-forest-900">
                        {f.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-forest-900 truncate text-sm">
                        {f.name}
                      </div>
                      <div className="text-[11px] text-ink-muted truncate">
                        {f.public_id}
                        {f.city || f.state_code
                          ? ` · ${[f.city, f.state_code].filter(Boolean).join(", ")}`
                          : ""}
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide text-gold-700">
                      Pick
                    </span>
                  </button>
                </li>
              ))}
              {!searching && results.length === 0 ? (
                <li className="text-sm text-ink-muted text-center py-4">
                  {query.trim()
                    ? "No firms match. Try a different name."
                    : "No firms in the directory yet."}
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
