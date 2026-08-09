import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Capacitor's plugin proxy is a THENABLE, and returning it bare from an
 * async function hangs forever.
 *
 * This was open for a month and cost every hypothesis in
 * docs/ and three memory files: plugin not registered (disproven at
 * bytecode level with dexdump), isPluginAvailable false (returns true),
 * R8 stripping (minifyEnabled false), lazy-chunk dynamic import (made
 * static in #475, changed nothing), iOS target membership (real, but
 * Android failed too). None of them was it.
 *
 * node_modules/@capacitor/core, registerPlugin:
 *
 *     const proxy = new Proxy({}, {
 *       get(_, prop) {
 *         switch (prop) {
 *           case '$$typeof':      return undefined;
 *           case 'toJSON':        return () => ({});
 *           case 'addListener':   ...
 *           case 'removeListener':...
 *           default:              return createPluginMethodWrapper(prop);
 *         }
 *       },
 *     });
 *
 * Four special cases. `then` is not among them, so `proxy.then` returns a
 * FUNCTION, which makes the proxy a thenable. `return proxy` from an async
 * function assimilates it: the runtime calls proxy.then(resolve, reject),
 * which dispatches a native call to a method named "then" that no plugin
 * implements. Nothing calls back, no rejection is thrown, and the await
 * never completes.
 *
 * The production signature, from the driver's phone on 2026-08-09:
 *
 *     device_probe        timeout
 *     device_probe_stage  bridge_reg   <- registerPlugin RETURNED
 *     device_probe_ms     3001
 *     timer_lag_ms        1            <- event loop perfectly healthy
 *
 * The stage says the proxy was created and the very next statement,
 * `onStage("call")`, was never reached. Only the await sits between them.
 *
 * The natural experiment that confirms it, in this repo, unchanged for
 * months: lib/watch/bridge.ts and lib/widget/bridge.ts both return
 * `{ bg: registerPlugin(...) }` — boxed — and both work. device-status
 * and geofence returned it bare, and are precisely the two that have
 * never once reported.
 */

/** A stand-in for Capacitor's proxy, shaped the same way. Every property
 *  except the special cases yields a function returning a promise that
 *  never settles, which is what a native call to a nonexistent method
 *  does. */
function capacitorLikeProxy(): unknown {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "$$typeof") return undefined;
        if (prop === "toJSON") return () => ({});
        return () => new Promise(() => {});
      },
    },
  );
}

/** Resolves to "settled" or "hung" without ever failing the run. */
async function settlesWithin<T>(p: Promise<T>, ms: number): Promise<string> {
  return Promise.race([
    p.then(() => "settled"),
    new Promise<string>((r) => setTimeout(() => r("hung"), ms)),
  ]);
}

describe("the Capacitor proxy is a thenable, so it must never be returned bare", () => {
  it("proves the proxy looks like a promise", () => {
    const proxy = capacitorLikeProxy() as { then?: unknown };
    expect(
      typeof proxy.then,
      "if this is not a function the trap does not exist and this whole " +
        "file can go",
    ).toBe("function");
  });

  it("hangs forever when an async function returns it bare", async () => {
    async function bare() {
      return capacitorLikeProxy();
    }
    expect(
      await settlesWithin(bare(), 150),
      "this is the month-long bug, reproduced in three lines",
    ).toBe("hung");
  });

  it("resolves immediately when the same proxy is boxed", async () => {
    async function boxed() {
      return { p: capacitorLikeProxy() };
    }
    expect(await settlesWithin(boxed(), 150)).toBe("settled");
  });

  it("hands back the identical proxy, so boxing costs nothing", async () => {
    const proxy = capacitorLikeProxy();
    const boxed = await (async () => ({ p: proxy }))();
    expect(boxed.p).toBe(proxy);
  });
});

/* ------------------------------------------------------------------ *
 * The static half: nobody may reintroduce the bare return.
 * ------------------------------------------------------------------ */

const SEARCH_DIRS = ["lib", "components", "app"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

describe("no source file returns a registerPlugin proxy bare", () => {
  const callers = SEARCH_DIRS.flatMap((d) => sourceFiles(d)).filter((f) =>
    readFileSync(f, "utf8").includes("registerPlugin<"),
  );

  it("finds the registerPlugin call sites", () => {
    // Guards the guard. If this ever reads zero, the check below passes
    // vacuously while the trap is wide open.
    expect(callers.length).toBeGreaterThan(3);
  });

  it("never returns the call's result directly", () => {
    const bad = callers.filter((f) =>
      /return\s+registerPlugin</.test(readFileSync(f, "utf8")),
    );
    expect(
      bad,
      "`return registerPlugin<...>(...)` from an async function assimilates " +
        "the thenable proxy and hangs forever. Box it: `return { p: ... }`.",
    ).toEqual([]);
  });

  it("boxes every proxy it assigns to a variable before returning it", () => {
    const bad: string[] = [];
    for (const f of callers) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*registerPlugin</);
        if (!m) return;
        const name = m[1];
        // The proxy must reach a return inside an object literal within a
        // few lines, never as `return <name>;`.
        const after = lines.slice(i + 1, i + 8).join("\n");
        const boxed = new RegExp(`return\\s*\\{[^}]*\\b${name}\\b`).test(after);
        const bare = new RegExp(`return\\s+${name}\\s*;`).test(after);
        if (bare || !boxed) bad.push(`${f}: ${name}`);
      });
    }
    expect(
      bad,
      "A registerPlugin proxy must be returned inside an object literal.",
    ).toEqual([]);
  });
});
