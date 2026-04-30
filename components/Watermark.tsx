/**
 * Tiled, low-opacity watermark that covers the entire viewport on
 * authenticated pages. The user's email is repeated across the page so
 * any screenshot or screen recording of the rendered surface includes
 * an identifying mark.
 *
 * Pure CSS, no JavaScript. Pointer-events: none so it never blocks
 * clicks. Sits at z-index 5 - above page content (z-index 0) but below
 * fixed headers (z-index 20+) and modals (z-index 50+) so it doesn't
 * obscure interactive UI.
 *
 * The watermark is a deterrent, not a defense. Anyone with a phone
 * camera or OBS can still capture the screen. What this gives us is
 * traceability: a leaked screenshot has the leaker's email painted on
 * it, and removing the watermark cleanly is materially harder than
 * just not leaking the screenshot in the first place.
 */
type Props = {
  email: string | null | undefined;
};

export function Watermark({ email }: Props) {
  if (!email) return null;
  // Build a single SVG with the email tiled diagonally. Repeat the
  // pattern via background tiling rather than embedding hundreds of
  // text nodes - one SVG, the browser tiles it.
  const safeEmail = email.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='560' height='320' viewBox='0 0 560 320'>
      <g transform='rotate(-22 280 160)' fill='rgba(15,45,36,0.10)'
         font-family='ui-sans-serif, system-ui, -apple-system, sans-serif'
         font-size='14'
         font-weight='500'>
        <text x='40' y='60'>${safeEmail}</text>
        <text x='240' y='160'>${safeEmail}</text>
        <text x='-40' y='260'>${safeEmail}</text>
        <text x='340' y='240'>${safeEmail}</text>
      </g>
    </svg>`.replace(/\s+/g, " ");
  const dataUri = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5,
        pointerEvents: "none",
        backgroundImage: dataUri,
        backgroundRepeat: "repeat",
        // Mix-blend so the mark adapts to dark and light surfaces.
        mixBlendMode: "multiply",
      }}
    />
  );
}
