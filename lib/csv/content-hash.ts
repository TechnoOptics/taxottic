/**
 * Content identity for an uploaded CSV.
 *
 * The user's case: "show me if there are duplicates when a document was
 * uploaded with a different name". Filenames are worthless for that, so this
 * hashes what is inside the file instead.
 *
 * Normalization before hashing is the whole trick. A bank statement
 * re-downloaded a week later is routinely byte-different and semantically
 * identical: a BOM appears, CRLF becomes LF, a trailing newline comes or goes.
 * A raw byte hash calls those four different documents and the duplicate
 * check never fires. So we flatten exactly the differences that carry no
 * meaning, and nothing else: case, interior blank lines, and every character
 * inside a field are left alone, because those DO change what gets imported.
 */

/**
 * Collapse the cosmetic differences between two exports of the same
 * statement. Deliberately conservative: it only touches the BOM, line
 * endings, trailing whitespace, and trailing blank lines.
 */
export function normalizeForHash(text: string): string {
  return (
    text
      // UTF-8 BOM, which Excel adds on "Save as CSV" and most bank exports omit.
      .replace(/^﻿/, "")
      // CRLF (Windows) and lone CR (classic Mac) both mean "new line".
      .replace(/\r\n?/g, "\n")
      // Trailing spaces/tabs on a line are invisible and carry no data.
      .replace(/[ \t]+$/gm, "")
      // Trailing blank lines. Interior blank lines are NOT collapsed: they
      // shift which row is which, so two files that differ there really are
      // different files.
      .replace(/\n+$/, "")
  );
}

/**
 * SHA-256 of the normalized content, lowercase hex.
 *
 * Uses Web Crypto, which is present in Node 20, the Edge runtime and the
 * browser alike, so the same function works in a server action and in a test
 * without a polyfill.
 */
export async function csvContentHash(text: string): Promise<string> {
  const normalized = normalizeForHash(text);
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
