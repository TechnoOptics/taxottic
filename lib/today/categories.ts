/** Year to date by category, largest first, fractions scaled to the largest. Spec 4.3 item 6. */
export function categoryTotals(
  rows: { categoryCode: string | null; amountCents: number }[],
  labelFor: (code: string) => string,
  max = 6,
) {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const code = r.categoryCode ?? "uncategorised";
    sums.set(code, (sums.get(code) ?? 0) + r.amountCents);
  }
  const ordered = [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
  const top = ordered[0]?.[1] ?? 0;
  return ordered.map(([code, amountCents]) => ({
    code,
    label: code === "uncategorised" ? "Uncategorised" : labelFor(code),
    amountCents,
    fraction: top > 0 ? Math.round((amountCents / top) * 1000) / 1000 : 0,
  }));
}
