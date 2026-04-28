import Link from "next/link";

type CompanyNavProps = {
  publicId: string;
  active: "forecast" | "income" | "expenses" | "import" | "profile" | "team";
};

const TABS = [
  { key: "forecast", label: "Forecast", path: "forecast" },
  { key: "income", label: "Income", path: "income" },
  { key: "expenses", label: "Expenses", path: "expenses" },
  { key: "import", label: "Import", path: "import" },
  { key: "profile", label: "Profile", path: "profile" },
  { key: "team", label: "Team", path: "manage" },
] as const;

export function CompanyNav({ publicId, active }: CompanyNavProps) {
  return (
    <nav className="border-b border-forest-100 -mx-6 px-6 overflow-x-auto">
      <ul className="flex gap-1 min-w-max">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={`/c/${publicId}/${t.path}`}
                className={[
                  "inline-flex h-11 items-center px-3 sm:px-4 text-sm border-b-2 -mb-px transition-colors",
                  isActive
                    ? "border-gold-400 text-forest-900 font-medium"
                    : "border-transparent text-ink-soft hover:text-forest-800 hover:border-gold-200",
                ].join(" ")}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
