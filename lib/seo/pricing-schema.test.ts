import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PLAN_PRICING } from "@/lib/plans/limits";

/**
 * Structured pricing is a promise made to a machine.
 *
 * A price in JSON-LD is what Google renders in a SERP snippet and what an
 * answer engine repeats when someone asks what Taxottic costs. If it
 * disagrees with what checkout charges, the failure is not cosmetic: the
 * buyer arrives quoting a number the product will not honour, and the
 * discrepancy is invisible from inside the app because nothing renders
 * the schema to a human.
 *
 * PLAN_PRICING (lib/plans/limits.ts) is the billing engine and therefore
 * the only source of truth. This test exists to keep the marketing graph
 * pinned to it.
 *
 * The concrete risk is not hypothetical. An audit on 2026-08-10 found
 * /pricing/firms publicly advertising a Starter $99 / Growth $249 /
 * Firm $599 ladder, indexable, with working "Start free trial" buttons,
 * while PLAN_PRICING tops out at Practice $299/mo and contains no such
 * SKUs at all. That page is a separate open decision, but it is exactly
 * the class of drift this file is here to prevent recurring in the
 * structured data, where it is even harder to notice.
 */

const HOME = "app/page.tsx";

function homeSource(): string {
  return readFileSync(HOME, "utf8");
}

/** Every price the billing engine can actually charge, as "4.99" strings. */
function enginePrices(): Set<string> {
  return new Set(
    Object.values(PLAN_PRICING).map((p) => (p.amountCents / 100).toFixed(2)),
  );
}

describe("structured pricing tracks the billing engine", () => {
  it("builds Offers from PLAN_PRICING rather than literals", () => {
    // The mechanism IS the guarantee. A hand-typed offers array would
    // pass every value assertion below on the day it was written and
    // silently rot at the next repricing, so assert the derivation.
    const src = homeSource();
    expect(src).toContain("PLAN_PRICING[k]");
    expect(
      src,
      "prices must be computed from amountCents, never typed as strings",
    ).toContain("(p.amountCents / 100).toFixed(2)");
  });

  it("derives the AggregateOffer from the same array it summarises", () => {
    // Not from a second call, and above all not from hand-written
    // lowPrice/highPrice. A summary that is computed separately from the
    // thing it summarises is just a second claim.
    const src = homeSource();
    expect(src).toContain("buildAggregateOffer(SUBSCRIPTION_OFFERS)");
    expect(src).toContain("offers: SUBSCRIPTION_OFFERS");
    expect(
      src,
      "a literal lowPrice stops being true at the next price change",
    ).not.toMatch(/lowPrice:\s*["']/);
    expect(src).not.toMatch(/highPrice:\s*["']/);
  });

  it("hardcodes no dollar figure the engine cannot charge", () => {
    // Catches a price pasted into copy, a comment, or a stray literal.
    // Scoped to the JSON-LD region so ordinary marketing prose ("from
    // $5 a month") is not swept up by a schema test.
    const src = homeSource();
    const start = src.indexOf("function buildSoftwareApplicationOffers");
    const end = src.indexOf("const NAV_LD");
    expect(start, "offers builder not found").toBeGreaterThan(-1);
    expect(end, "end marker not found").toBeGreaterThan(start);

    const schemaRegion = src.slice(start, end);
    const allowed = enginePrices();
    const stray: string[] = [];
    for (const m of schemaRegion.matchAll(/\$(\d[\d,]*(?:\.\d{2})?)/g)) {
      const n = m[1].replace(/,/g, "");
      const norm = Number(n).toFixed(2);
      if (!allowed.has(norm)) stray.push(m[0]);
    }
    expect(
      stray,
      "These dollar figures appear in the structured-data region but " +
        "match no price in PLAN_PRICING. Structured pricing must never " +
        "advertise a number checkout will not honour.",
    ).toEqual([]);
  });

  it("prices every paid tier, so none is invisible to a crawler", () => {
    // Free is deliberately excluded (price 0 is not a commercial offer
    // in schema.org terms), so the count is every PLAN_PRICING entry.
    const src = homeSource();
    const keyBlock = src.slice(
      src.indexOf("const keys: SubscriptionPriceKey[]"),
      src.indexOf("return keys.map"),
    );
    const listed = [...keyBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual(Object.keys(PLAN_PRICING).sort());
  });

  it("quotes USD everywhere, because the product is United States only", () => {
    const src = homeSource();
    const currencies = [
      ...src.matchAll(/priceCurrency:\s*["']([A-Z]{3})["']/g),
    ].map((m) => m[1]);
    expect(currencies.length).toBeGreaterThan(0);
    expect([...new Set(currencies)]).toEqual(["USD"]);
  });
});
