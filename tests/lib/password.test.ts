import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

/** PBKDF2 at an arbitrary iteration count, so a test can forge a record the
 *  public API would never produce. Mirrors the implementation's parameters. */
async function deriveKey(password: string, saltHex: string, iterations: number) {
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// PBKDF2 at 210k iterations is slow on purpose — that is the point of it — so
// these stay few and deliberate rather than exhaustive.
describe("guest password hashing", () => {
  it("verifies a password against its own hash", async () => {
    const stored = await hashPassword("moon-shoes-42");
    expect(await verifyPassword("moon-shoes-42", stored)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const stored = await hashPassword("moon-shoes-42");
    expect(await verifyPassword("moon-shoes-43", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts each hash, so the same password stores differently every time", async () => {
    // Without this, identical guest passwords would be visibly identical in
    // the database and precomputation would work against them.
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("stores a parseable record and never the password itself", async () => {
    const stored = await hashPassword("plaintext-should-not-appear");
    const [scheme, iterations, salt, key] = stored.split("$");
    expect(scheme).toBe("pbkdf2");
    expect(Number(iterations)).toBeGreaterThanOrEqual(210_000);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain("plaintext-should-not-appear");
  });

  it("refuses malformed or unknown-scheme records instead of throwing", async () => {
    for (const bad of ["", "not-a-hash", "pbkdf2$1$aa$bb$cc", "bcrypt$210000$aa$bb"]) {
      expect(await verifyPassword("whatever", bad)).toBe(false);
    }
  });

  it("refuses a record whose iteration count has been lowered", async () => {
    // A stored record is data. If someone could rewrite it to one iteration,
    // verification would become cheap to brute force — so there is a floor.
    //
    // The record below is internally CONSISTENT: the key really is the
    // one-iteration derivation of this password and salt. That matters —
    // pairing a 210k key with "$1$" would be rejected by the hash comparison
    // whether or not the floor exists, and would prove nothing.
    const salt = "00".repeat(16);
    const weakKey = await deriveKey("moon-shoes-42", salt, 1);
    expect(await verifyPassword("moon-shoes-42", `pbkdf2$1$${salt}$${weakKey}`)).toBe(false);

    // Same password and salt at a legitimate count still verifies, so the
    // rejection above is the floor and not a broken helper.
    const strongKey = await deriveKey("moon-shoes-42", salt, 210_000);
    expect(await verifyPassword("moon-shoes-42", `pbkdf2$210000$${salt}$${strongKey}`)).toBe(true);
  });
});
