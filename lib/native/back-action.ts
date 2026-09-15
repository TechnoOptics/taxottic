/**
 * Android's system Back. The plugin reports canGoBack from the WebView's
 * own history; the old handler also accepted `window.history.length > 1`,
 * which a single-page app never lets fall to 1, so Back at the root did
 * nothing (Android audit C3: five presses, activity still resumed).
 */
export function backAction(canGoBack: boolean): "back" | "exit" {
  return canGoBack ? "back" : "exit";
}
