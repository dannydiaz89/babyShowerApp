import { describe, expect, it } from "vitest";
import { siteOriginFrom } from "../../src/lib/site-origin";

/**
 * What address the tidy cron will be told to call. It has to be the one a
 * host's browser reached the site on, and never a development address a
 * cron in the cloud could not reach.
 */
function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("siteOriginFrom", () => {
  it("uses the forwarded host and protocol behind a proxy", () => {
    expect(
      siteOriginFrom(headers({ "x-forwarded-host": "shower.example", "x-forwarded-proto": "https" }))
    ).toBe("https://shower.example");
  });

  it("falls back to the plain host, over https", () => {
    expect(siteOriginFrom(headers({ host: "shower.example" }))).toBe("https://shower.example");
  });

  it("keeps a port and takes the first of several forwarded values", () => {
    expect(
      siteOriginFrom(headers({ "x-forwarded-host": "web:3001, proxy", "x-forwarded-proto": "http, https" }))
    ).toBe("http://web:3001");
  });

  it("refuses development addresses the cron could not reach", () => {
    for (const host of ["localhost:3001", "127.0.0.1:3001", "mac.local", "app.localhost"]) {
      expect(siteOriginFrom(headers({ host, "x-forwarded-proto": "http" }))).toBeNull();
    }
  });

  it("refuses a missing host or a protocol that is not http(s)", () => {
    expect(siteOriginFrom(headers({}))).toBeNull();
    expect(siteOriginFrom(headers({ host: "shower.example", "x-forwarded-proto": "ftp" }))).toBeNull();
  });
});
