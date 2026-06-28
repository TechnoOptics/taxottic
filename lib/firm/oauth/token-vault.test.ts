import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptTokenJson,
  decryptTokenJson,
  isOnPrimaryKey,
  reencryptBlob,
} from "./token-vault";

// Two distinct 32-byte keys (64 hex chars each).
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

const saved = {
  primary: process.env.OAUTH_TOKEN_VAULT_KEY,
  olds: process.env.OAUTH_TOKEN_VAULT_KEYS_OLD,
  svc: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeEach(() => {
  delete process.env.OAUTH_TOKEN_VAULT_KEYS_OLD;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.OAUTH_TOKEN_VAULT_KEY = KEY_A;
});

afterEach(() => {
  process.env.OAUTH_TOKEN_VAULT_KEY = saved.primary;
  process.env.OAUTH_TOKEN_VAULT_KEYS_OLD = saved.olds;
  process.env.SUPABASE_SERVICE_ROLE_KEY = saved.svc;
});

describe("token-vault encryption", () => {
  it("round-trips a payload and produces a v1: blob", () => {
    const blob = encryptTokenJson({ v: "12-3456789" });
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain("3456789");
    expect(decryptTokenJson<{ v: string }>(blob)).toEqual({ v: "12-3456789" });
  });

  it("decodes a legacy v0 (base64 JSON, no prefix) blob", () => {
    const legacy = Buffer.from(JSON.stringify({ access_token: "x" })).toString(
      "base64",
    );
    expect(decryptTokenJson(legacy)).toEqual({ access_token: "x" });
  });

  it("returns null for empty / garbage input", () => {
    expect(decryptTokenJson(null)).toBeNull();
    expect(decryptTokenJson("v1:not-valid-base64!!")).toBeNull();
  });
});

describe("key rotation", () => {
  it("decrypts old-key ciphertext after rotating the primary", () => {
    const blob = encryptTokenJson({ v: "secret" }); // written under A

    // Rotate: B is now primary, A retired.
    process.env.OAUTH_TOKEN_VAULT_KEY = KEY_B;
    process.env.OAUTH_TOKEN_VAULT_KEYS_OLD = KEY_A;

    expect(decryptTokenJson<{ v: string }>(blob)).toEqual({ v: "secret" });
    // It's still on the OLD key, so it should be flagged for re-encryption.
    expect(isOnPrimaryKey(blob)).toBe(false);
  });

  it("cannot decrypt once the old key is dropped", () => {
    const blob = encryptTokenJson({ v: "secret" }); // under A
    process.env.OAUTH_TOKEN_VAULT_KEY = KEY_B; // A gone entirely
    expect(decryptTokenJson(blob)).toBeNull();
  });

  it("reencryptBlob migrates ciphertext onto the new primary", () => {
    const oldBlob = encryptTokenJson({ v: "secret" }); // under A
    process.env.OAUTH_TOKEN_VAULT_KEY = KEY_B;
    process.env.OAUTH_TOKEN_VAULT_KEYS_OLD = KEY_A;

    const newBlob = reencryptBlob(oldBlob);
    expect(newBlob).toBeTruthy();
    expect(newBlob).not.toBe(oldBlob);
    // Now decryptable + on the primary even with the old key removed.
    process.env.OAUTH_TOKEN_VAULT_KEYS_OLD = "";
    expect(decryptTokenJson<{ v: string }>(newBlob)).toEqual({ v: "secret" });
    expect(isOnPrimaryKey(newBlob)).toBe(true);
  });

  it("reencryptBlob upgrades a legacy v0 blob onto the primary", () => {
    const legacy = Buffer.from(JSON.stringify({ v: "x" })).toString("base64");
    const migrated = reencryptBlob(legacy);
    expect(migrated?.startsWith("v1:")).toBe(true);
    expect(decryptTokenJson<{ v: string }>(migrated)).toEqual({ v: "x" });
  });
});
