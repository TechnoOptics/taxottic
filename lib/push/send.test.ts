import { describe, it, expect } from "vitest";
import {
  sendToUser,
  type PushStore,
  type PushProvider,
  type Platform,
} from "./send";

function fakeStore(
  tokens: { token: string; platform: Platform }[],
): PushStore & { claimed: Set<string>; revoked: string[] } {
  const claimed = new Set<string>();
  const revoked: string[] = [];
  let live = [...tokens];
  return {
    claimed,
    revoked,
    async listActiveTokens() {
      return live;
    },
    async claimDedupe(_u, key) {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    async revokeToken(_u, token) {
      revoked.push(token);
      live = live.filter((t) => t.token !== token);
    },
  };
}

function fakeProvider(
  behavior: (token: string) => {
    delivered: boolean;
    invalidToken?: boolean;
    throws?: boolean;
  } = () => ({ delivered: true }),
): PushProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async send(token) {
      calls.push(token);
      const b = behavior(token);
      if (b.throws) throw new Error("transport down");
      return { delivered: b.delivered, invalidToken: b.invalidToken };
    },
  };
}

const EVENT = { kind: "trip_classify", tripId: "t1" } as const;

describe("sendToUser", () => {
  it("claims dedupe then fans out to every active token", async () => {
    const store = fakeStore([
      { token: "a", platform: "ios" },
      { token: "b", platform: "android" },
    ]);
    const provider = fakeProvider();
    const r = await sendToUser(store, provider, "u1", EVENT);
    expect(r).toEqual({ sent: true, delivered: 2, revoked: 0 });
    expect(provider.calls.sort()).toEqual(["a", "b"]);
    expect(store.claimed.has("trip_classify:t1")).toBe(true);
  });

  it("a duplicate logical event is a no-op (no second fan-out)", async () => {
    const store = fakeStore([{ token: "a", platform: "ios" }]);
    const provider = fakeProvider();
    await sendToUser(store, provider, "u1", EVENT);
    const second = await sendToUser(store, provider, "u1", EVENT);
    expect(second).toEqual({ sent: false, delivered: 0, revoked: 0 });
    expect(provider.calls).toEqual(["a"]); // only the first send
  });

  it("invalid token is revoked and counted", async () => {
    const store = fakeStore([
      { token: "good", platform: "ios" },
      { token: "dead", platform: "android" },
    ]);
    const provider = fakeProvider((t) =>
      t === "dead"
        ? { delivered: false, invalidToken: true }
        : { delivered: true },
    );
    const r = await sendToUser(store, provider, "u1", EVENT);
    expect(r).toEqual({ sent: true, delivered: 1, revoked: 1 });
    expect(store.revoked).toEqual(["dead"]);
  });

  it("a provider throw is a soft miss, not a crash; dedupe stays claimed", async () => {
    const store = fakeStore([
      { token: "x", platform: "ios" },
      { token: "y", platform: "android" },
    ]);
    const provider = fakeProvider((t) =>
      t === "x" ? { delivered: false, throws: true } : { delivered: true },
    );
    const r = await sendToUser(store, provider, "u1", EVENT);
    expect(r).toEqual({ sent: true, delivered: 1, revoked: 0 });
    // Not re-sent on a retry, the row was already claimed.
    const retry = await sendToUser(store, provider, "u1", EVENT);
    expect(retry.sent).toBe(false);
  });

  it("no devices → claimed but nothing delivered", async () => {
    const store = fakeStore([]);
    const provider = fakeProvider();
    const r = await sendToUser(store, provider, "u1", EVENT);
    expect(r).toEqual({ sent: true, delivered: 0, revoked: 0 });
  });
});
