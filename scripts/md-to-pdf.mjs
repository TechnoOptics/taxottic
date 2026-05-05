import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { marked } from "marked";

const inputMd = process.argv[2];
const outputPdf = process.argv[3];
if (!inputMd || !outputPdf) {
  console.error("Usage: node md-to-pdf.mjs <input.md> <output.pdf>");
  process.exit(1);
}

const md = readFileSync(inputMd, "utf8");

const firstH1 = md.match(/^#\s+(.+?)\s*$/m);
const docTitle = firstH1 ? firstH1[1] : path.basename(inputMd, path.extname(inputMd));
const mdWithoutFirstH1 = firstH1 ? md.replace(firstH1[0], "").replace(/^\s+/, "") : md;

const inputDir = path.dirname(path.resolve(inputMd));

// Inline-base64 every local image reference. Markdown ![]()  becomes a
// data: URL so the PDF renders standalone without depending on
// filesystem layout at conversion time.
const bodyHtml = marked.parse(mdWithoutFirstH1);
const body = bodyHtml.replace(/<img\s+([^>]*?)src="([^"]+)"([^>]*)>/g, (m, pre, src, post) => {
  if (/^(?:data:|https?:|file:)/i.test(src)) return m;
  const absolute = path.isAbsolute(src) ? src : path.resolve(inputDir, src);
  if (!existsSync(absolute)) return m;
  const ext = path.extname(absolute).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : "image/png";
  const data = readFileSync(absolute).toString("base64");
  return `<img ${pre}src="data:${mime};base64,${data}"${post}>`;
});

const logoPath = path.resolve("public/brand/full-logo.png");
const logoB64 = readFileSync(logoPath).toString("base64");
const logoDataUrl = `data:image/png;base64,${logoB64}`;

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const css = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.5;
  color: #1a1a1a;
  margin: 0;
  padding: 0;
}
.brand-header {
  margin: 0 0 1.4em 0;
  padding: 0 0 0.9em 0;
  border-bottom: 2px solid #0f2d24;
}
.brand-header img {
  width: 220pt;
  height: auto;
  display: block;
}
h1.doc-title {
  font-size: 22pt;
  font-weight: 700;
  margin: 0 0 0.6em 0;
  color: #0f2d24;
  page-break-after: avoid;
}
h1 {
  font-size: 18pt;
  font-weight: 700;
  margin: 1.4em 0 0.5em 0;
  color: #0f2d24;
  page-break-after: avoid;
}
h2 {
  font-size: 14pt;
  font-weight: 700;
  margin: 1.6em 0 0.6em 0;
  color: #0f2d24;
  page-break-after: avoid;
}
h3 {
  font-size: 11.5pt;
  font-weight: 600;
  margin: 1.2em 0 0.4em 0;
  color: #1a4031;
  page-break-after: avoid;
}
p { margin: 0 0 0.7em 0; }
ul, ol { margin: 0 0 0.8em 1.2em; padding: 0; }
li { margin: 0.15em 0; }
strong { color: #0f2d24; }
hr {
  border: none;
  border-top: 1px solid #c9c9c9;
  margin: 1.6em 0;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0 1.2em 0;
  font-size: 9.5pt;
  page-break-inside: avoid;
}
thead th {
  background: #0f2d24;
  color: #fbf7e9;
  text-align: left;
  padding: 6pt 8pt;
  font-weight: 600;
}
tbody td {
  border-bottom: 1px solid #d0d0d0;
  padding: 5pt 8pt;
  vertical-align: top;
}
tbody tr:nth-child(even) td { background: #f6f4ec; }
code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 9pt;
  background: #f0ece0;
  padding: 0.1em 0.35em;
  border-radius: 3px;
}
pre {
  background: #f0ece0;
  padding: 8pt 10pt;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 9pt;
  page-break-inside: avoid;
}
pre code {
  background: transparent;
  padding: 0;
}
a { color: #0f2d24; text-decoration: underline; }
@page {
  size: Letter;
  margin: 0.75in 0.75in 0.85in 0.75in;
  @bottom-left {
    content: "Techno Optics LLC";
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 8pt;
    color: #888;
  }
  @bottom-center {
    content: "${escapeHtml(docTitle).replace(/"/g, '\\"')}";
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 8pt;
    color: #888;
  }
  @bottom-right {
    content: "Page " counter(page) " of " counter(pages);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 8pt;
    color: #888;
  }
}
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(docTitle)} - Techno Optics LLC</title>
<style>${css}</style>
</head>
<body>
<div class="brand-header"><img src="${logoDataUrl}" alt="Taxottic"></div>
<h1 class="doc-title">${escapeHtml(docTitle)}</h1>
${body}
</body>
</html>`;

const absOutputPdf = path.resolve(outputPdf);
const tmpHtml = absOutputPdf.replace(/\.pdf$/i, ".tmp.html");
writeFileSync(tmpHtml, html, "utf8");

const chromePaths = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Users/abelm/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe",
];
const chrome = chromePaths.find((p) => existsSync(p));
if (!chrome) {
  console.error("Could not find a Chrome binary in the expected locations");
  process.exit(2);
}

const fileUrl = "file:///" + tmpHtml.replace(/\\/g, "/");
execFileSync(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--print-to-pdf-no-header",
    `--print-to-pdf=${absOutputPdf}`,
    fileUrl,
  ],
  { stdio: "inherit" },
);

try { unlinkSync(tmpHtml); } catch {}
console.log("Wrote", absOutputPdf);
