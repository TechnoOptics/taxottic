import { describe, it, expect, vi } from "vitest";
import {
  planStripeCursorAdvance,
  type StripeListParams,
} from "./cursor";

/**
 * A fake Stripe balance_transactions endpoint over a fixed, newest-first list.
 * Honours the two params the driver uses:
 *   - created.gte : filter to ids created on/after the bound (initial pull)
 *   - starting_after : return the slice AFTER that id (older records)
 * and pages by `pageSize`, setting has_more when more remain. This mirrors
 * Stripe's real semantics closely enough to exercise cursor advancement.
 */
function fakeStripe(
  all: { id: string; created: number; type?: string }[],
  pageSize: number,
) {
  // Newest-first, like Stripe.
  const sorted = [...all].sort((a, b) => b.created - a.created);
  const calls: StripeListParams[] = [];
  const fetchPage = vi.fn(async (params: StripeListParams) => {
    calls.push(params);
    let window = sorted;
    if (params.created?.gte !== undefined) {
      window = window.filter((t) => t.created >= params.created!.gte!);
    }
    if (params.starting_after) {
      const idx = window.findIndex((t) => t.id === params.starting_after);
      window = idx >= 0 ? window.slice(idx + 1) : [];
    }
    const data = window.slice(0, params.limit);
    return { data, has_more: window.length > params.limit };
  });
  return { fetchPage, calls };
}

const tx = (id: string, created: number, type = "charge") => ({
  id,
  created,
  type,
});

describe("planStripeCursorAdvance", () => {
  it("initial pull (no watermark) bounds by year start and returns newest id as cursor", async () => {
    // 3 transactions this year, newest = t3.
    const all = [tx("t1", 100), tx("t2", 200), tx("t3", 300)];
    const { fetchPage, calls } = fakeStripe(all, 100);

    const plan = await planStripeCursorAdvance({
      watermark: null,
      yearStartUnix: 50,
      pageSize: 100,
      maxPages: 5,
      fetchPage,
    });

    expect(plan.fresh.map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
    expect(plan.newCursor).toBe("t3");
    expect(plan.reachedWatermark).toBe(false);
    // First page of an initial pull carries the created bound, no cursor.
    expect(calls[0].created).toEqual({ gte: 50 });
    expect(calls[0].starting_after).toBeUndefined();
  });

  it("incremental sync pulls ONLY charges newer than the watermark and stops at it", async () => {
    // t100 was the newest imported last run; t101..t103 are new since.
    const all = [
      tx("t100", 100),
      tx("t101", 101),
      tx("t102", 102),
      tx("t103", 103),
    ];
    const { fetchPage, calls } = fakeStripe(all, 100);

    const plan = await planStripeCursorAdvance({
      watermark: "t100",
      yearStartUnix: 0,
      pageSize: 100,
      maxPages: 5,
      fetchPage,
    });

    // Newest-first, everything above the watermark, watermark excluded.
    expect(plan.fresh.map((t) => t.id)).toEqual(["t103", "t102", "t101"]);
    expect(plan.reachedWatermark).toBe(true);
    expect(plan.newCursor).toBe("t103");
    // Incremental first page sends neither a created bound nor a cursor:
    // it lists from the very newest transaction downward.
    expect(calls[0].created).toBeUndefined();
    expect(calls[0].starting_after).toBeUndefined();
  });

  it("no new transactions -> no fresh rows, cursor stays put (the regression)", async () => {
    // Watermark IS the newest transaction: a Sync that should no-op cleanly,
    // WITHOUT the old bug of marching the cursor backward past the newest data.
    const all = [tx("t1", 100), tx("t2", 200), tx("t3", 300)];
    const { fetchPage } = fakeStripe(all, 100);

    const plan = await planStripeCursorAdvance({
      watermark: "t3",
      yearStartUnix: 0,
      pageSize: 100,
      maxPages: 5,
      fetchPage,
    });

    expect(plan.fresh).toEqual([]);
    expect(plan.reachedWatermark).toBe(true);
    // Cursor unchanged - and crucially still the NEWEST id, so the next sync
    // with a brand-new charge will pick it up (the whole point of the fix).
    expect(plan.newCursor).toBe("t3");
    expect(plan.hitPageCapWithoutWatermark).toBe(false);
  });

  it("advances across pages via starting_after and stops when it meets the watermark", async () => {
    // 5 new transactions (t201..t205) above the watermark t200, pageSize 2:
    // forces 3 pages, the walk must paginate OLDER via starting_after.
    const all = [
      tx("t200", 200),
      tx("t201", 201),
      tx("t202", 202),
      tx("t203", 203),
      tx("t204", 204),
      tx("t205", 205),
    ];
    const { fetchPage, calls } = fakeStripe(all, 2);

    const plan = await planStripeCursorAdvance({
      watermark: "t200",
      yearStartUnix: 0,
      pageSize: 2,
      maxPages: 5,
      fetchPage,
    });

    expect(plan.fresh.map((t) => t.id)).toEqual([
      "t205",
      "t204",
      "t203",
      "t202",
      "t201",
    ]);
    expect(plan.reachedWatermark).toBe(true);
    expect(plan.newCursor).toBe("t205");
    // Page 2+ paginate downward from the last id of the previous page.
    expect(calls[1].starting_after).toBe("t204");
    expect(calls[2].starting_after).toBe("t202");
  });

  it("flags a page-cap gap when a high-volume account never reaches the watermark", async () => {
    // 6 new transactions but only 2 pages of 2 allowed = 4 fetched, watermark
    // t0 never reached. Must still advance the cursor to the newest seen.
    const all = Array.from({ length: 7 }, (_, i) => tx(`h${i}`, i));
    const { fetchPage } = fakeStripe(all, 2);

    const plan = await planStripeCursorAdvance({
      watermark: "h0",
      yearStartUnix: 0,
      pageSize: 2,
      maxPages: 2,
      fetchPage,
    });

    expect(plan.reachedWatermark).toBe(false);
    expect(plan.fetched).toBe(4);
    expect(plan.hitPageCapWithoutWatermark).toBe(true);
    expect(plan.newCursor).toBe("h6"); // newest seen, never nulled
  });

  it("recovers once from a transient mid-walk failure by restarting from the top", async () => {
    const all = [
      tx("r1", 1),
      tx("r2", 2),
      tx("r3", 3),
      tx("r4", 4),
    ];
    // pageSize 2, watermark r1 -> page 1 = [r4,r3], page 2 (starting_after r3)
    // throws once, then the restart-from-top re-walks cleanly.
    let thrown = false;
    const fetchPage = vi.fn(async (params: StripeListParams) => {
      const sorted = [...all].sort((a, b) => b.created - a.created);
      if (params.starting_after === "r3" && !thrown) {
        thrown = true;
        throw new Error("stripe 500");
      }
      let window = sorted;
      if (params.starting_after) {
        const idx = window.findIndex((t) => t.id === params.starting_after);
        window = idx >= 0 ? window.slice(idx + 1) : [];
      }
      const data = window.slice(0, params.limit);
      return { data, has_more: window.length > params.limit };
    });

    const plan = await planStripeCursorAdvance({
      watermark: "r1",
      yearStartUnix: 0,
      pageSize: 2,
      maxPages: 5,
      fetchPage,
    });

    // After recovery, the fresh set is exactly the newer-than-watermark rows,
    // with no duplicates from the aborted first attempt.
    expect(plan.fresh.map((t) => t.id)).toEqual(["r4", "r3", "r2"]);
    expect(plan.reachedWatermark).toBe(true);
    expect(plan.newCursor).toBe("r4");
    expect(thrown).toBe(true);
  });

  it("rethrows if the walk fails a second time (recovery is one-shot)", async () => {
    const fetchPage = vi.fn(async (params: StripeListParams) => {
      if (params.starting_after) throw new Error("stripe down");
      return {
        data: [tx("a2", 2), tx("a1", 1)],
        has_more: true, // force a second page (which throws)
      };
    });

    await expect(
      planStripeCursorAdvance({
        watermark: null,
        yearStartUnix: 0,
        pageSize: 2,
        maxPages: 5,
        fetchPage,
      }),
    ).rejects.toThrow("stripe down");
  });
});
