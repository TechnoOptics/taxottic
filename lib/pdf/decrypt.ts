// Server-side helper for password-protected PDFs. Anthropic's API does
// not accept a password parameter on PDF inputs, so when a user uploads
// a locked W-2 or prior-year return we have to (a) decrypt with the
// password the user supplies and (b) ship the pages to Claude as images
// instead of as a sealed PDF.
//
// Using pdfjs-dist's legacy build because the modern build expects DOM
// globals; the legacy build runs cleanly in Node. Rendering uses
// @napi-rs/canvas which works in Vercel serverless without any system
// dependencies (pure native binary, prebuilt for the Vercel runtime).

import { createCanvas } from "@napi-rs/canvas";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";

// pdfjs 5.x always wants a worker. On Node it spins up a "fake worker"
// that just runs the worker code on the main thread, but the loader
// still complains if `workerSrc` is empty. We resolve the worker path
// lazily on first use because top-level resolve() crashes Next's build-
// time page-data collector under Turbopack.
let workerInitialized = false;
async function ensureWorkerSrc() {
  if (workerInitialized) return;
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const req = createRequire(import.meta.url);
  // pdfjs validates workerSrc by passing it to `new URL(...)` — on
  // Windows a bare filesystem path with backslashes doesn't parse,
  // and even on Linux pdfjs prefers an explicit file:// URL. Convert
  // the resolved path to a URL string before assigning.
  const resolvedPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  GlobalWorkerOptions.workerSrc = pathToFileURL(resolvedPath).href;
  workerInitialized = true;
}

/** Thrown when the user-supplied password is wrong (or missing). */
export class PdfPasswordError extends Error {
  readonly missing: boolean;
  constructor(message: string, missing: boolean) {
    super(message);
    this.name = "PdfPasswordError";
    this.missing = missing;
  }
}

export type RenderedPage = {
  /** Page number, 1-indexed, matches the PDF's own page numbering. */
  pageNumber: number;
  /** PNG bytes, base64-encoded, ready to embed in an Anthropic image block. */
  base64: string;
};

/**
 * Decrypt + render every page of a (potentially) password-protected PDF
 * to PNG images. Pure-JS path, no shell-out.
 *
 * @param pdfBytes - the raw PDF buffer as the route received it.
 * @param password - the password the user typed into the popup. Pass an
 *                   empty string for an unlocked PDF; pdfjs ignores the
 *                   password if the PDF isn't encrypted.
 * @param scale    - render scale; 2.0 gives ~2x natural size which is
 *                   enough for Claude to read box numbers reliably without
 *                   blowing through the 5 MB-per-image API limit.
 */
export async function decryptAndRenderPdf(
  pdfBytes: Uint8Array,
  password: string,
  scale = 2.0,
): Promise<RenderedPage[]> {
  await ensureWorkerSrc();

  let doc: PDFDocumentProxy;
  try {
    // pdfjs's TS types under-declare the legacy build's options; we hand
    // it a node-compatible canvasFactory so it can build off-screen
    // surfaces during rendering. The runtime accepts it; typings don't.
    doc = await getDocument({
      data: new Uint8Array(pdfBytes),
      password: password || undefined,
      disableFontFace: true,
      useSystemFonts: false,
      canvasFactory: new NodeCanvasFactory(),
    } as Parameters<typeof getDocument>[0]).promise;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // pdfjs throws "PasswordException" for both missing and wrong
    // passwords; the `code` distinguishes them but the wrapper class
    // is private. We pattern-match on the message for stability.
    const lower = message.toLowerCase();
    if (lower.includes("no password")) {
      throw new PdfPasswordError("Password required", true);
    }
    if (lower.includes("incorrect password")) {
      throw new PdfPasswordError("Incorrect password", false);
    }
    throw err;
  }

  const pages: RenderedPage[] = [];
  // Cap pages at 10 — anything more is almost certainly an entire
  // tax return, and we'd send 5 MB of images per page which gets
  // expensive fast. The caller's existing 8 MB upload cap usually
  // bounds this naturally; the explicit cap is belt-and-suspenders.
  const maxPages = Math.min(doc.numPages, 10);
  for (let i = 1; i <= maxPages; i++) {
    const page: PDFPageProxy = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const context = canvas.getContext("2d");
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const png = await canvas.encode("png");
    pages.push({ pageNumber: i, base64: png.toString("base64") });
    page.cleanup();
  }
  await doc.cleanup();
  await doc.destroy();
  return pages;
}

// ---------------------------------------------------------------------------
// pdfjs's `canvasFactory` is the seam where it asks for off-screen surfaces
// during text and image rendering. We hand it back @napi-rs canvases.
// ---------------------------------------------------------------------------

// Loosely typed because pdfjs's BaseCanvasFactory is private; the runtime
// only needs an object with create / reset / destroy methods.
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }

  reset(
    canvasAndContext: { canvas: { width: number; height: number } },
    width: number,
    height: number,
  ) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: { canvas: { width: number; height: number } }) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}
