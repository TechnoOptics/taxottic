"use client";

import Link from "next/link";
import { useState } from "react";
import { FindFirmDialog } from "@/components/FindFirmDialog";

type Firm = {
  public_id: string;
  name: string;
  logo_url: string | null;
  accent_color: string | null;
  city: string | null;
  state_code: string | null;
  website: string | null;
  status: string;
};

type Engagement = {
  id: string;
  firm_id: string;
  tax_year: number;
  kind: string;
  status: string;
  requested_at: string;
  requested_by_side: string;
  client_note: string | null;
  firm_note: string | null;
  scope_summary: string | null;
  ended_at: string | null;
  firm: Firm | null;
};

type SearchFirmRow = {
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
  companyPublicId: string;
  companyName: string;
  isManager: boolean;
  defaultTaxYear: number;
  engagements: Engagement[];
  searchAction: (q: string) => Promise<SearchFirmRow[]>;
  requestAction: (formData: FormData) => Promise<void>;
  cancelAction: (formData: FormData) => Promise<void>;
  acceptAction: (formData: FormData) => Promise<void>;
  declineAction: (formData: FormData) => Promise<void>;
  endAction: (formData: FormData) => Promise<void>;
};

const STATUS_LABEL: Record<string, string> = {
  pending_firm: "Awaiting firm acceptance",
  pending_client: "Awaiting your acceptance",
  active: "Active",
  completed: "Completed",
  declined: "Declined",
  terminated: "Ended",
};

const KIND_LABEL: Record<string, string> = {
  tax_prep: "Tax preparation",
  audit_support: "Audit support",
  bookkeeping: "Bookkeeping",
  advisory: "Advisory",
};

export function PreparerPanel({
  companyId,
  companyPublicId,
  companyName,
  isManager,
  defaultTaxYear,
  engagements,
  searchAction,
  requestAction,
  cancelAction,
  acceptAction,
  declineAction,
  endAction,
}: Props) {
  const [showFind, setShowFind] = useState(false);

  const active = engagements.filter((e) => e.status === "active");
  const pendingMine = engagements.filter((e) => e.status === "pending_firm");
  const pendingTheirs = engagements.filter(
    (e) => e.status === "pending_client",
  );
  const history = engagements.filter(
    (e) =>
      e.status === "declined" ||
      e.status === "terminated" ||
      e.status === "completed",
  );

  return (
    <>
      <section className="mt-6 card p-6 sm:p-7">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="display text-xl text-forest-900">
              Your tax preparer
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-md">
              Engage an accounting firm or CPA on Taxottic Enterprise to
              prepare your return. They get read-only access to{" "}
              <span className="text-forest-800 font-medium">
                {companyName}
              </span>
              's books only after you both confirm the engagement.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {isManager ? (
              <button
                onClick={() => setShowFind(true)}
                className="btn-primary text-sm"
                type="button"
              >
                + Find a tax preparer
              </button>
            ) : (
              <p className="text-xs text-ink-muted max-w-[14rem]">
                Only the company manager can engage a preparer.
              </p>
            )}
            {active.length > 0 ? (
              <Link
                href={`/c/${companyPublicId}/preparer/access`}
                className="text-xs text-forest-700 hover:text-forest-900 underline"
              >
                What can my preparer see? →
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {pendingTheirs.length > 0 ? (
        <section className="mt-4">
          <h3 className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium px-1">
            Awaiting your acceptance
          </h3>
          <ul className="mt-2 grid gap-2">
            {pendingTheirs.map((e) => (
              <li key={e.id} className="card p-5">
                <Header eng={e} />
                {e.firm_note ? (
                  <blockquote className="mt-3 rounded-lg bg-cream/50 border-l-4 border-gold-400 px-4 py-3 text-sm text-ink-soft italic">
                    "{e.firm_note}"
                  </blockquote>
                ) : null}
                {isManager ? (
                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <form action={acceptAction}>
                      <input
                        type="hidden"
                        name="engagement_id"
                        value={e.id}
                      />
                      <input
                        type="hidden"
                        name="company_id"
                        value={companyId}
                      />
                      <button className="btn-primary text-sm">
                        Accept and grant access
                      </button>
                    </form>
                    <form action={declineAction}>
                      <input
                        type="hidden"
                        name="engagement_id"
                        value={e.id}
                      />
                      <input
                        type="hidden"
                        name="company_id"
                        value={companyId}
                      />
                      <button className="btn-ghost text-sm">Decline</button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {active.length > 0 ? (
        <section className="mt-6">
          <h3 className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium px-1">
            Active engagements
          </h3>
          <ul className="mt-2 grid gap-2">
            {active.map((e) => (
              <li key={e.id} className="card p-5">
                <Header eng={e} />
                {isManager ? (
                  <details className="mt-3 group">
                    <summary className="text-xs text-ink-muted hover:text-red-700 cursor-pointer list-none inline-flex items-center gap-1">
                      End this engagement
                    </summary>
                    <form action={endAction} className="mt-3">
                      <input
                        type="hidden"
                        name="engagement_id"
                        value={e.id}
                      />
                      <input
                        type="hidden"
                        name="company_id"
                        value={companyId}
                      />
                      <p className="text-xs text-ink-soft mb-2">
                        Ending the engagement immediately revokes the
                        firm's access to your books. They keep any audit
                        cases or notes they created on their side.
                      </p>
                      <button className="text-xs text-red-700 hover:text-red-900">
                        Confirm end engagement
                      </button>
                    </form>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pendingMine.length > 0 ? (
        <section className="mt-6">
          <h3 className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium px-1">
            Requests you sent
          </h3>
          <ul className="mt-2 grid gap-2">
            {pendingMine.map((e) => (
              <li key={e.id} className="card p-5">
                <Header eng={e} />
                {isManager ? (
                  <form action={cancelAction} className="mt-3">
                    <input type="hidden" name="engagement_id" value={e.id} />
                    <input
                      type="hidden"
                      name="company_id"
                      value={companyId}
                    />
                    <button className="text-xs text-ink-muted hover:text-red-700">
                      Cancel request
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {active.length === 0 &&
      pendingMine.length === 0 &&
      pendingTheirs.length === 0 ? (
        <section className="mt-6 card p-5 sm:p-7 text-center">
          <h3 className="display text-xl text-forest-900">
            No tax preparer yet.
          </h3>
          <p className="mt-2 text-sm text-ink-soft max-w-md mx-auto leading-relaxed">
            When you find a firm and send a request, they'll see your
            engagement on their side and accept it. Once active, they get
            read-only access to your books for the agreed tax year.
          </p>
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="mt-8">
          <h3 className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium px-1">
            Past engagements
          </h3>
          <ul className="mt-2 grid gap-2">
            {history.map((e) => (
              <li key={e.id} className="rounded-lg border border-forest-100 bg-white/60 px-4 py-3 text-sm">
                <Header eng={e} dim />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showFind ? (
        <FindFirmDialog
          companyId={companyId}
          defaultTaxYear={defaultTaxYear}
          searchAction={searchAction}
          requestAction={requestAction}
          onClose={() => setShowFind(false)}
        />
      ) : null}
    </>
  );
}

function Header({ eng, dim = false }: { eng: Engagement; dim?: boolean }) {
  const f = eng.firm;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {f?.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={f.logo_url}
          alt=""
          className={
            "size-12 rounded-xl border border-forest-100 bg-white object-contain p-1.5 " +
            (dim ? "opacity-70" : "")
          }
        />
      ) : (
        <span
          className={
            "size-12 rounded-xl bg-cream/70 border border-forest-100 grid place-items-center display text-xl text-forest-900 " +
            (dim ? "opacity-70" : "")
          }
        >
          {(f?.name ?? "?").charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className={"display text-base text-forest-900 truncate " + (dim ? "opacity-80" : "")}>
          {f?.name ?? "Unknown firm"}
        </div>
        <div className="text-[11px] text-ink-muted">
          {f?.public_id ?? ""}
          {f?.city || f?.state_code
            ? ` · ${[f?.city, f?.state_code].filter(Boolean).join(", ")}`
            : ""}
          {f?.website ? (
            <>
              {" "}
              ·{" "}
              <a
                href={f.website}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                website
              </a>
            </>
          ) : null}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wide text-gold-700">
          {KIND_LABEL[eng.kind] ?? eng.kind} · TY {eng.tax_year}
        </div>
        <div className="text-xs text-forest-800 font-medium mt-0.5">
          {STATUS_LABEL[eng.status] ?? eng.status}
        </div>
      </div>
    </div>
  );
}
