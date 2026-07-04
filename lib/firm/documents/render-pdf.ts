// Server-side HTML → PDF rendering for tax forms.
//
// We use puppeteer-core + @sparticuz/chromium because that's the
// standard Vercel-compatible Chromium setup (the regular puppeteer
// pulls in a 200MB Chromium binary that won't deploy to Lambda;
// @sparticuz/chromium is the slimmed-down version that ships with
// Vercel Function size limits).
//
// Local dev: the @sparticuz package falls back to your installed
// Chrome at /Applications/Google Chrome.app/Contents/MacOS/Google
// Chrome (macOS) or C:\Program Files\Google\Chrome\Application\
// chrome.exe (Windows) via puppeteer-core's executablePath option.
// Set PUPPETEER_EXECUTABLE_PATH to override.
//
// Production (Vercel): no env var needed; @sparticuz handles it.
//
// The rendered PDF uses the same HTML templates the firm reviews
// in the browser, no parallel template tree to keep in sync.

import type { Browser } from "puppeteer-core";

type RenderArgs = {
  html: string;
  /** Page format. Defaults to Letter (US standard for tax forms). */
  format?: "Letter" | "A4" | "Legal";
  /** Set true on the rare form that needs landscape. */
  landscape?: boolean;
  /** Margins in CSS units; defaults align with @page in our templates. */
  margins?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
};

let cachedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (cachedBrowser) return cachedBrowser;

  const puppeteer = (await import("puppeteer-core")).default;
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    // Vercel / serverless: use @sparticuz/chromium.
    const chromium = (await import("@sparticuz/chromium")).default;
    cachedBrowser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: chromium.defaultViewport,
    });
  } else {
    // Dev: use the local Chrome install.
    const exe =
      process.env.PUPPETEER_EXECUTABLE_PATH ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    cachedBrowser = await puppeteer.launch({
      executablePath: exe,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return cachedBrowser;
}

/**
 * Render HTML to PDF bytes. The caller saves to Supabase Storage
 * and updates the firm_documents row's storage_path + content_type.
 */
export async function renderHtmlToPdf(args: RenderArgs): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(args.html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: args.format ?? "Letter",
      landscape: args.landscape ?? false,
      printBackground: true,
      preferCSSPageSize: true,
      margin: args.margins ?? {
        top: "0.75in",
        right: "0.75in",
        bottom: "0.75in",
        left: "0.75in",
      },
    });
    // puppeteer-core returns a Buffer in Node; coerce to Uint8Array
    // so the upload contract matches Edge runtimes too.
    return new Uint8Array(pdf);
  } finally {
    await page.close();
  }
}

/**
 * Best-effort cleanup; the in-process browser pool is intentionally
 * one-shot for serverless. In long-running workers we'd implement a
 * proper pool with reuse + idle timeout.
 */
export async function closePdfRenderer(): Promise<void> {
  if (cachedBrowser) {
    await cachedBrowser.close().catch(() => {});
    cachedBrowser = null;
  }
}
