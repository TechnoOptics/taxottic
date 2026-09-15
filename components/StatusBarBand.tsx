/**
 * The strip under the OS status bar on the native shell. Zero height on
 * the web (no safe-area inset). Colour comes from --status-band, which
 * html[data-bar="navy"] sets; see lib/native/status-bar.ts.
 */
export function StatusBarBand() {
  return <div id="status-bar-band" aria-hidden="true" />;
}
