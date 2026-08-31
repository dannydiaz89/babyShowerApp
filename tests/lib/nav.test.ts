import { describe, expect, it } from "vitest";
import { safeNext } from "../../src/lib/nav";

/**
 * `next` arrives on the query string and is handed to Next's redirect(), which
 * accepts absolute URLs. Anything that leaves this origin is an open redirect
 * — a link that looks like the real invitation and lands on someone else's
 * password form.
 */
describe("safeNext", () => {
  it("keeps a path inside the site", () => {
    expect(safeNext("/rsvp")).toBe("/rsvp");
    expect(safeNext("/registry?from=email")).toBe("/registry?from=email");
  });

  it("refuses another origin", () => {
    expect(safeNext("https://attacker.example")).toBe("/invitation");
    expect(safeNext("http://attacker.example")).toBe("/invitation");
  });

  it("refuses a protocol-relative URL, which a browser reads as another host", () => {
    expect(safeNext("//attacker.example")).toBe("/invitation");
    // Browsers normalise the backslash to a slash before resolving.
    expect(safeNext("/\\attacker.example")).toBe("/invitation");
  });

  it("refuses control characters used to smuggle one of those past a check", () => {
    expect(safeNext("/\nhttps://attacker.example")).toBe("/invitation");
    expect(safeNext("/\tinvitation")).toBe("/invitation");
  });

  it("refuses anything that isn't a string, including a missing value", () => {
    expect(safeNext(undefined)).toBe("/invitation");
    expect(safeNext(null)).toBe("/invitation");
    expect(safeNext("")).toBe("/invitation");
    expect(safeNext(["/rsvp"])).toBe("/invitation");
  });

  it("uses the fallback it was given", () => {
    expect(safeNext("https://attacker.example", "/")).toBe("/");
  });
});
