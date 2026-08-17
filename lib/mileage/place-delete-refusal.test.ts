import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * deleteMileagePlace must REFUSE OUT LOUD.
 *
 * THE BUG THIS CATCHES.
 *
 * The action used to end every refusal with a bare `return;`:
 *
 *   if (!row) return;        // place already gone
 *   if (!member) return;     // caller is not in the place's company
 *
 * and it dropped the `error` from the delete itself. It returns `void`,
 * so nothing it declined ever reached a caller. The page then re-rendered
 * with the place still on it and nothing said, which on a touch device
 * reads as a tap that missed the button.
 *
 * That matters more than it looks. A saved place is what makes drives to
 * an address auto-classify as business; the row also carries coordinates
 * and a radius that cannot be recovered from the UI. So both outcomes,
 * "removed" and "refused", looked identical on a screen where one of them
 * silently stops future drives being deductible.
 *
 * components/mileage/DeletePlaceButton.tsx awaits this action and renders
 * what it throws. That error branch is only reachable if the action
 * actually throws, so this test pins the half the component cannot pin
 * itself: a bare `return;` here turns the component's catch into dead
 * code and restores the silent failure with no other symptom.
 *
 * Comments are STRIPPED BEFORE MATCHING. This repo has twice shipped a
 * guard that was really matching the prose in a doc comment above the
 * code, so the assertions below only ever see executable text.
 */

const SOURCE = "app/mileage/places/actions.ts";

/** Remove block and line comments so assertions match code, never prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The executable body of a top-level `export async function <name>`. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`${name} not found in ${SOURCE}`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe("deleteMileagePlace refuses out loud", () => {
  const body = functionBody(
    stripComments(readFileSync(SOURCE, "utf8")),
    "deleteMileagePlace",
  );

  it("has no bare `return;` that would swallow a refusal", () => {
    // Every early exit is a refusal the user needs to see. A bare return
    // is indistinguishable from success to an awaiting caller.
    expect(body).not.toMatch(/\breturn\s*;/);
  });

  // Each refusal is pinned to ITS OWN branch. A bare count of `throw`
  // in the body is not enough: deleting one guard's throw while the
  // other three remain keeps the count and reopens exactly one silent
  // failure, which is how this would regress in practice.
  const REFUSALS: Array<[string, string]> = [
    ["place row is missing", "!row"],
    ["caller is not in the place's company", "!member"],
    ["the delete itself was rejected", "error"],
  ];

  it.each(REFUSALS)("throws when %s", (_label, condition) => {
    // Whitespace-normalised so a reformat cannot silently un-pin this.
    const flat = body.replace(/\s+/g, " ");
    expect(flat).toContain(`if (${condition}) throw new Error(`);
  });

  it("checks the delete's own error rather than discarding it", () => {
    // `await admin.from(...).delete()` with the result dropped is the
    // same silent failure one layer down: RLS or a constraint refuses
    // and the action still reports success.
    expect(body).toMatch(/error\s*[:}]/);
    expect(body).toMatch(/\.delete\(\)/);
  });
});
