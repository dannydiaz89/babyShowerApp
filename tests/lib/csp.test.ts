import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, cspNonce } from "../../src/lib/csp";

/** Pull one directive out of the joined policy string. */
function directive(csp: string, name: string): string | undefined {
  return csp.split("; ").find((d) => d.startsWith(`${name} `) || d === name);
}

describe("contentSecurityPolicy", () => {
  it("carries the nonce in script-src, where Next.js looks for it", () => {
    // Next reads the nonce back out of this header with the equivalent of
    // /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/ against the script-src sources.
    // If the shape drifts, Next silently stops noncing and the page ships
    // with no working JavaScript at all.
    const script = directive(contentSecurityPolicy("abc123==", false), "script-src");
    expect(script).toContain("'nonce-abc123=='");
  });

  it("never admits an inline script", () => {
    for (const isDev of [true, false]) {
      expect(directive(contentSecurityPolicy(cspNonce(), isDev), "script-src")).not.toContain(
        "'unsafe-inline'"
      );
    }
  });

  it("keeps eval and websockets to development, where React Refresh needs them", () => {
    const dev = contentSecurityPolicy("n", true);
    const prod = contentSecurityPolicy("n", false);

    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
    expect(directive(prod, "connect-src")).toBe("connect-src 'self'");
  });

  it("upgrades insecure requests only in production, so a phone can reach the dev server", () => {
    expect(contentSecurityPolicy("n", false)).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("n", true)).not.toContain("upgrade-insecure-requests");
  });

  it("still locks down the directives an injected page would reach for", () => {
    const csp = contentSecurityPolicy("n", false);
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
  });
});

describe("contentSecurityPolicy origins", () => {
  it("admits the photo storage host for images only", () => {
    const csp = contentSecurityPolicy("n", false, {
      imageOrigins: ["https://happy-otter-123.convex.cloud"],
    });
    expect(directive(csp, "img-src")).toContain("https://happy-otter-123.convex.cloud");
    expect(directive(csp, "connect-src")).not.toContain("convex.cloud");
    expect(directive(csp, "script-src")).not.toContain("convex.cloud");
  });

  it("admits the Drive upload host for requests only", () => {
    const csp = contentSecurityPolicy("n", false, {
      connectOrigins: ["https://www.googleapis.com"],
    });
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://www.googleapis.com");
    expect(directive(csp, "img-src")).not.toContain("googleapis");
  });

  it("reduces a URL with a path to its origin, and drops anything that is not https", () => {
    const csp = contentSecurityPolicy("n", false, {
      imageOrigins: [
        "https://deploy.convex.cloud/api/storage/abc",
        "http://insecure.example",
        "not a url",
        "",
      ],
    });
    expect(directive(csp, "img-src")).toBe(
      "img-src 'self' data: blob: https://deploy.convex.cloud"
    );
  });

  it("leaves the policy unchanged when no origins are given", () => {
    expect(contentSecurityPolicy("n", false, {})).toBe(contentSecurityPolicy("n", false));
  });
});

describe("cspNonce", () => {
  it("is fresh every call — a repeated nonce is not a nonce", () => {
    const seen = new Set(Array.from({ length: 500 }, () => cspNonce()));
    expect(seen.size).toBe(500);
  });

  it("stays inside the alphabet the CSP grammar and Next's parser accept", () => {
    for (let i = 0; i < 50; i++) {
      expect(cspNonce()).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/);
    }
  });
});
