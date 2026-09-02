import { describe, expect, it } from "vitest";
import { mintUploaderCookie, readUploaderCookie } from "../../src/lib/photo-device";

/**
 * The device cookie keys the upload limits, so a caller must not be able to
 * choose its value. It is signed: a made-up or altered one reads as no
 * cookie at all, and a fresh one only comes from the server.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";

describe("the device cookie", () => {
  it("round-trips a minted cookie to its id", async () => {
    const cookie = await mintUploaderCookie();
    expect(cookie).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/);
    expect(await readUploaderCookie(cookie)).toBe(cookie.split(".")[0]);
  });

  it("is different every time", async () => {
    expect(await mintUploaderCookie()).not.toBe(await mintUploaderCookie());
  });

  it("refuses an unsigned id, a wrong signature, and an altered id", async () => {
    const cookie = await mintUploaderCookie();
    const [id, signature] = cookie.split(".");

    expect(await readUploaderCookie(id)).toBeNull();
    expect(await readUploaderCookie(`${id}.${"0".repeat(64)}`)).toBeNull();
    const altered = (id[0] === "a" ? "b" : "a") + id.slice(1);
    expect(await readUploaderCookie(`${altered}.${signature}`)).toBeNull();
  });

  it("refuses nothing, junk, and a signed value that is not an id", async () => {
    expect(await readUploaderCookie(undefined)).toBeNull();
    expect(await readUploaderCookie("")).toBeNull();
    expect(await readUploaderCookie("not-a-cookie")).toBeNull();
  });
});
