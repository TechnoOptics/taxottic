/** Spec 4.4: Today, Drives, Money, Forecast (More is the rail). */
export type TabKey = "today" | "drives" | "money" | "forecast";

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
