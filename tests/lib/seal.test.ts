import { describe, expect, it } from "vitest";
import { open, seal } from "../../src/lib/seal";

/**
 * The Drive refresh token sits in the database sealed under AUTH_SECRET.
 * These say that the database alone is not enough to read it, and that a
 * value that has been fiddled with is refused rather than decrypted wrong.
 */

const SECRET = "test-secret-not-a-real-one";

describe("seal / open", () => {
  it("round-trips under the same secret", async () => {
    const sealed = await seal("1//refresh-token", SECRET);
    expect(await open(sealed, SECRET)).toBe("1//refresh-token");
  });

  it("does not put the plaintext in the output", async () => {
    const sealed = await seal("1//refresh-token", SECRET);
    expect(sealed).not.toContain("refresh-token");
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("seals the same value differently each time", async () => {
    const a = await seal("same", SECRET);
    const b = await seal("same", SECRET);
    expect(a).not.toBe(b);
  });

  it("refuses the wrong secret", async () => {
    const sealed = await seal("1//refresh-token", SECRET);
    expect(await open(sealed, "another-secret")).toBeNull();
  });

  it("refuses a value that has been altered", async () => {
    const sealed = await seal("1//refresh-token", SECRET);
    const [v, nonce, body] = sealed.split(".");
    /*
     * Alter a character in the middle, not the last one: the final base64
     * character can carry only padding bits, and changing those decodes to
     * the same bytes — which made this test flaky about one run in twenty.
     */
    const at = 5;
    const flipped = body.slice(0, at) + (body[at] === "A" ? "B" : "A") + body.slice(at + 1);
    expect(await open(`${v}.${nonce}.${flipped}`, SECRET)).toBeNull();
  });

  it("refuses something that was never sealed", async () => {
    expect(await open("", SECRET)).toBeNull();
    expect(await open("v1.short", SECRET)).toBeNull();
    expect(await open("v2.AAAAAAAAAAAAAAAA.AAAA", SECRET)).toBeNull();
    expect(await open("not base64!.$$$", SECRET)).toBeNull();
  });

  it("will not seal without a secret", async () => {
    await expect(seal("x", "")).rejects.toThrow();
  });
});
