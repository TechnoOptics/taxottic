import { describe, it, expect, vi } from "vitest";
import { DRIVE_PAGE_SIZE, loadDrivePage } from "./drive-page";
import * as scope from "./team-scope";

describe("the drive page has no window", () => {
  it("asks for the newest drives with a floor that excludes nothing", async () => {
    const spy = vi
      .spyOn(scope, "loadScopedTrips")
      .mockResolvedValue([] as never);
    await loadDrivePage(null as never, {
      companyId: "co_1",
      scope: { kind: "self", driverUserId: "u_1" },
    });
    const arg = spy.mock.calls[0][1];
    expect(
      new Date(arg.sinceIso).getUTCFullYear(),
      "a floor inside living memory is a window, and a window is what made this page open empty",
    ).toBeLessThan(2000);
    expect(arg.limit).toBe(DRIVE_PAGE_SIZE);
    spy.mockRestore();
  });

  it("pages older drives strictly before the cursor", async () => {
    const rows = [
      { id: "a", started_at: "2026-09-20T10:00:00.000Z" },
      { id: "b", started_at: "2026-09-19T10:00:00.000Z" },
    ];
    vi.spyOn(scope, "loadScopedTrips").mockResolvedValue(rows as never);
    const out = await loadDrivePage<{ id: string; started_at: string }>(
      null as never,
      {
        companyId: "co_1",
        scope: { kind: "self", driverUserId: "u_1" },
        before: "2026-09-20T00:00:00.000Z",
      },
    );
    expect(out.map((r) => r.id), "the cursor row must not repeat").toEqual(["b"]);
    vi.restoreAllMocks();
  });

  it("defaults the page size to 60", () => {
    expect(DRIVE_PAGE_SIZE).toBe(60);
  });
});
