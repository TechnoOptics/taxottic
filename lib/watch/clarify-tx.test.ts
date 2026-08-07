import { describe, expect, it } from "vitest";
import { clarifyBankTransactionCore, clarifyStatus } from "./clarify-tx";

const COMPANY = "company-1";
const MANAGER = "user-manager";
const OWNER = "user-owner";
const EXPENSER = "user-expenser";
const OUTSIDER = "user-outsider";

type Row = Record<string, unknown>;

type Tables = {
  bank_transactions: Row[];
  bank_imports: Row[];
  company_members: Row[];
};

/** Minimal stand-in for the PostgREST builder: the handful of calls
 *  clarifyBankTransactionCore makes, over in-memory arrays. Every
 *  update is recorded so a test can assert what was written. */
function fakeAdmin(tables: Tables) {
  const updates: { table: string; patch: Row; id: unknown }[] = [];

  function query(table: keyof Tables) {
    const filters: [string, unknown][] = [];
    let pendingPatch: Row | null = null;

    const builder = {
      select() {
        return builder;
      },
      update(patch: Row) {
        pendingPatch = patch;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        if (pendingPatch) {
          // Terminal for the update path: apply and record.
          const patch = pendingPatch;
          for (const row of tables[table]) {
            if (filters.every(([c, v]) => row[c] === v)) Object.assign(row, patch);
          }
          updates.push({ table, patch, id: value });
          pendingPatch = null;
          return Promise.resolve({ error: null });
        }
        return builder;
      },
      maybeSingle() {
        const hit = tables[table].find((row) =>
          filters.every(([c, v]) => row[c] === v),
        );
        return Promise.resolve({ data: hit ?? null, error: null });
      },
    };
    return builder;
  }

  return {
    client: { from: (table: keyof Tables) => query(table) },
    updates,
    tables,
  };
}

function seed(): Tables {
  return {
    bank_transactions: [
      {
        id: "tx-owner",
        company_id: COMPANY,
        import_id: "imp-owner",
        suggested_category_code: "meals",
        applied_category_code: null,
        ignored: false,
      },
      {
        id: "tx-expenser",
        company_id: COMPANY,
        import_id: "imp-expenser",
        suggested_category_code: "supplies",
        applied_category_code: null,
        ignored: false,
      },
    ],
    bank_imports: [
      { id: "imp-owner", company_id: COMPANY, user_id: OWNER },
      { id: "imp-expenser", company_id: COMPANY, user_id: EXPENSER },
    ],
    company_members: [
      { company_id: COMPANY, user_id: MANAGER, role: "manager" },
      { company_id: COMPANY, user_id: OWNER, role: "manager" },
      { company_id: COMPANY, user_id: EXPENSER, role: "expenser" },
    ],
  };
}

describe("clarifyBankTransactionCore", () => {
  it("refuses a member acting on someone else's import", async () => {
    const { client, updates } = fakeAdmin(seed());
    const res = await clarifyBankTransactionCore(
      client,
      EXPENSER,
      "tx-owner",
      true,
    );
    expect(res).toEqual({ ok: false, reason: "forbidden" });
    expect(updates).toHaveLength(0);
  });

  it("refuses a non-member of the transaction's company", async () => {
    const { client, updates } = fakeAdmin(seed());
    const res = await clarifyBankTransactionCore(
      client,
      OUTSIDER,
      "tx-owner",
      true,
    );
    expect(res).toEqual({ ok: false, reason: "forbidden" });
    expect(updates).toHaveLength(0);
  });

  it("lets a member clarify a transaction from their own import", async () => {
    const fake = fakeAdmin(seed());
    const res = await clarifyBankTransactionCore(
      fake.client,
      EXPENSER,
      "tx-expenser",
      true,
    );
    expect(res).toEqual({ ok: true });
    const row = fake.tables.bank_transactions.find(
      (r) => r.id === "tx-expenser",
    );
    expect(row?.applied_category_code).toBe("supplies");
    expect(row?.ignored).toBe(false);
  });

  it("lets a manager clarify any transaction in the company", async () => {
    const fake = fakeAdmin(seed());
    const res = await clarifyBankTransactionCore(
      fake.client,
      MANAGER,
      "tx-expenser",
      true,
    );
    expect(res).toEqual({ ok: true });
    expect(
      fake.tables.bank_transactions.find((r) => r.id === "tx-expenser")
        ?.applied_category_code,
    ).toBe("supplies");
  });

  it("ignores the row and clears the category on a personal call", async () => {
    const fake = fakeAdmin(seed());
    const res = await clarifyBankTransactionCore(
      fake.client,
      MANAGER,
      "tx-owner",
      false,
    );
    expect(res).toEqual({ ok: true });
    const row = fake.tables.bank_transactions.find((r) => r.id === "tx-owner");
    expect(row?.ignored).toBe(true);
    expect(row?.applied_category_code).toBeNull();
  });

  it("reports a missing transaction as not_found, not forbidden", async () => {
    const { client } = fakeAdmin(seed());
    const res = await clarifyBankTransactionCore(
      client,
      MANAGER,
      "tx-nope",
      true,
    );
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an empty id before touching the database", async () => {
    const { client, updates } = fakeAdmin(seed());
    const res = await clarifyBankTransactionCore(client, MANAGER, "", true);
    expect(res).toEqual({ ok: false, reason: "invalid" });
    expect(updates).toHaveLength(0);
  });
});

describe("clarifyStatus", () => {
  it("maps each reason to its HTTP status", () => {
    expect(clarifyStatus("invalid")).toBe(400);
    expect(clarifyStatus("forbidden")).toBe(403);
    expect(clarifyStatus("not_found")).toBe(404);
    expect(clarifyStatus("db")).toBe(500);
  });
});
