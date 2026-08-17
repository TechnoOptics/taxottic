/**
 * The deterministic public surface, shared by the specs that sweep it.
 *
 * Lives here rather than inside visual.spec.ts so the pixel suite and the
 * ground-colour suite can never drift apart: adding a page to the visual
 * regression automatically adds it to the colour assertion, and vice
 * versa. Deliberately NOT a Playwright spec file — the default testMatch
 * only picks up *.spec.ts, so this is imported, never executed as tests.
 *
 * Why this list: no auth, no live figures, no relative timestamps, so
 * every page here renders identically run to run, and between them they
 * exercise the same component library as the authenticated screens.
 */
export const PUBLIC_PAGES: { name: string; path: string }[] = [
  { name: "home", path: "/" },
  { name: "pricing", path: "/pricing" },
  { name: "calculators-hub", path: "/calculators" },
  { name: "calc-self-employment-tax", path: "/calculators/self-employment-tax" },
  { name: "calc-effective-tax-rate", path: "/calculators/effective-tax-rate" },
  { name: "calc-mileage-deduction", path: "/calculators/mileage-deduction" },
  { name: "guide-quarterly", path: "/guides/quarterly-estimated-taxes-explained" },
  { name: "compare-hub", path: "/compare" },
];
