/**
 * Which JS bundle is this code?
 *
 * The app is a Capacitor WebView on a REMOTE url, so the native binary
 * version (`@capacitor/app` getInfo, reported as `app_version`) says nothing
 * about which web bundle is actually executing. A phone can run native 1.3.7
 * while its service worker serves a JS bundle from a week earlier. That has
 * happened here for real: sw.js records both drivers sitting on a bundle in
 * the v135 to v141 range for four days while production served v148.
 *
 * WHY THIS EXISTS. Device-truth fields have been NULL on 100% of heartbeats
 * since the table was created. A fix shipped on 2026-08-01 (#475) that
 * replaced a hanging `await import("@capacitor/core")` with a static import.
 * 343 heartbeats since then report the identical failure
 * (`device_probe=timeout`, `device_probe_stage=bridge`), and `bridge` is the
 * stage the OLD dynamic-import code reported.
 *
 * So either the fix does not work, or those devices never received it. Those
 * demand opposite responses, and RIGHT NOW THE DATA CANNOT TELL THEM APART,
 * because nothing in the heartbeat identifies the bundle that produced it.
 *
 * That ambiguity is the actual bug. The same trap already cost this project
 * weeks: a bare NULL could not distinguish "no bridge" from "plugin missing"
 * from "call hung", and making the emptiness self-describing settled it in
 * one heartbeat. This does the same thing one level up.
 *
 * Resolution order, each a build-time inline so it costs nothing at runtime:
 *   1. NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA  set automatically by Vercel
 *   2. NEXT_PUBLIC_BUILD_ID               escape hatch for other builders
 *   3. "dev"                              local development
 */
const RAW =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_BUILD_ID ||
  "dev";

/** Short, stable, and safe to log. A commit sha is trimmed to 12 chars so it
 *  stays readable in a table without losing uniqueness in practice. */
export const WEB_BUILD_ID: string = RAW.slice(0, 12);
