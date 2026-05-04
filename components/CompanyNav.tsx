import Link from "next/link";

type CompanyNavProps = {
  publicId: string;
  active:
    | "forecast"
    | "income"
    | "expenses"
    | "deductions"
    | "banks"
    | "sales-tax"
    | "import"
    | "profile"
    | "team"
    | "chat"
    | "preparer";
};

const TABS = [
  { key: "forecast", label: "Forecast", path: "forecast" },
  { key: "income", label: "Income", path: "income" },
  { key: "expenses", label: "Expenses", path: "expenses" },
  { key: "deductions", label: "Deductions", path: "deductions" },
  { key: "banks", label: "Banks", path: "banks" },
  { key: "sales-tax", label: "Sales tax", path: "sales-tax" },
  { key: "import", label: "Import", path: "import" },
  { key: "profile", label: "Profile", path: "profile" },
  { key: "team", label: "Team", path: "manage" },
  { key: "chat", label: "Chat", path: "chat" },
  { key: "preparer", label: "Tax preparer", path: "preparer" },
] as const;

/**
 * Sub-navigation tabs under each company page. The strip can scroll
 * horizontally on narrow screens, but we hide the scrollbar chrome
 * (no-scrollbar) so a Windows / Linux grey scroll-thumb doesn't cheapen
 * the page header it sits beneath.
 */
export function CompanyNav({ publicId, active }: CompanyNavProps) {
  return (
    <nav
      className="-mx-6 px-6 overflow-x-auto no-scrollbar relative"
      aria-label="Company sections"
    >
      <ul className="flex gap-1 min-w-max">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={`/c/${publicId}/${t.path}`}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "relative inline-flex h-11 items-center px-3 sm:px-4",
                  "text-sm tracking-wide -mb-px transition-colors",
                  isActive
                    ? "text-forest-900 font-medium"
                    : "text-ink-soft hover:text-forest-800",
                ].join(" ")}
              >
                {t.label}
                {/* Active indicator: tapered gold underline that fades at
                    each end so it reads as engraved, not painted on. */}
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full"
                    style={{
                      background:
                        "linear-gradient(90deg, transparent, var(--color-gold-400) 30%, var(--color-gold-500) 50%, var(--color-gold-400) 70%, transparent)",
                    }}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* Hairline gold rule running the full width under the tabs. */}
      <div
        aria-hidden="true"
        className="absolute left-0 right-0 bottom-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(213, 187, 126, 0.45) 8%, rgba(15, 45, 36, 0.18) 50%, rgba(213, 187, 126, 0.45) 92%, transparent)",
        }}
      />
    </nav>
  );
}
