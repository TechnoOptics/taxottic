/** Spec 4.4: Today, Drives, Money, Forecast (More is the rail). */
export type TabKey = "today" | "drives" | "money" | "forecast";

/**
 * Memberships with the active company first.
 *
 * Money and Forecast point at one company, so it has to be the one the
 * rest of the app treats as active: profile.active_company_id when the
 * user still belongs to it, otherwise their first membership. AppHeader
 * already resolves its outstanding-tasks tally that way; `companies[0]`
 * on its own sent a three-company user's tabs to whichever company they
 * happened to join first, which is not where their header, their rail or
 * their tally were pointing.
 */
export function activeCompanyFirst<T extends { id: string }>(companies: T[], activeCompanyId: string | null): T[] {
  const at = activeCompanyId ? companies.findIndex((c) => c.id === activeCompanyId) : -1;
  if (at <= 0) return companies;
  return [companies[at], ...companies.slice(0, at), ...companies.slice(at + 1)];
}

export function tabBarLinks(input: {
  companies: { public_id: string; role: string }[];
  storedMode: "business" | "personal" | null;
  pathname: string;
}): { key: TabKey; label: string; href: string; current: boolean }[] {
  const company = input.companies[0]?.public_id ?? null;
  const business = input.storedMode === "business" && company !== null;
  const base = business ? `/c/${company}` : "/personal";
  const links = [
    { key: "today" as const, label: "Today", href: "/dashboard" },
    { key: "drives" as const, label: "Drives", href: "/mileage" },
    { key: "money" as const, label: "Money", href: `${base}/expenses` },
    { key: "forecast" as const, label: "Forecast", href: `${base}/forecast` },
  ];
  return links.map((l) => ({ ...l, current: input.pathname === l.href || input.pathname.startsWith(`${l.href}/`) }));
}
