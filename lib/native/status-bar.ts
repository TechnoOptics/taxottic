/**
 * What the status bar should look like on this page.
 *
 * Both audits measured the clock at about 1.1:1 on light pages: the shell
 * forced light glyphs everywhere, and the navy band meant to sit behind
 * them was a second `body::before` rule that the ambient backdrop's own
 * `body::before` overrode (iOS C1, Android I1). The band is now a real
 * element, its colour and the plugin's style come from one attribute the
 * app header sets, and Android reapplies on every configuration change
 * (a fold left the bar unreadable until force-stop, Android C4).
 */
export type Bar = "paper" | "navy";

export function barOf(root: { dataset: { bar?: string } }): Bar {
  return root.dataset.bar === "navy" ? "navy" : "paper";
}

/** `style` is the @capacitor/status-bar Style name: Light means dark glyphs. */
export function statusBarPlan(bar: Bar, theme: "light" | "dark"): { style: "Light" | "Dark"; color: string } {
  if (bar === "navy") return { style: "Dark", color: "#121a2a" };
  return theme === "dark" ? { style: "Dark", color: "#0c1017" } : { style: "Light", color: "#f2f5f8" };
}
