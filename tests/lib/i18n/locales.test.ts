import { describe, expect, it } from "vitest";
import { isLocale, preferredLocale } from "@/lib/i18n/locales";

describe("isLocale", () => {
  it("accepts only the languages the site actually publishes", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("es-MX")).toBe(false); // the cookie stores a bare locale
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(2)).toBe(false);
  });
});

describe("Accept-Language negotiation", () => {
  it("uses a phone set to Spanish", () => {
    expect(preferredLocale("es-MX,es;q=0.9,en;q=0.8")).toBe("es");
  });

  it("uses a phone set to English", () => {
    expect(preferredLocale("en-US,en;q=0.9,es;q=0.8")).toBe("en");
  });

  it("respects quality over written order", () => {
    // Regression. The header is quality-ranked, not ordered: this reader is
    // asking for Spanish, and reading only the leading tag returns English.
    expect(preferredLocale("en;q=0.5,es;q=0.9")).toBe("es");
  });

  it("skips an unsupported language rather than giving up on the rest", () => {
    // A French-first reader who also reads Spanish should get Spanish, not be
    // dropped to the English default because tag one did not match.
    expect(preferredLocale("fr,es;q=0.9,en;q=0.5")).toBe("es");
  });

  it("matches any Spanish region to Spanish", () => {
    for (const tag of ["es", "es-MX", "es-419", "es-ES", "ES-mx"]) {
      expect(preferredLocale(tag)).toBe("es");
    }
  });

  it("keeps header order when qualities tie", () => {
    expect(preferredLocale("en,es")).toBe("en");
    expect(preferredLocale("es,en")).toBe("es");
  });

  it("honours q=0 as a refusal", () => {
    expect(preferredLocale("es;q=0,en")).toBe("en");
  });

  it("treats a malformed q as unacceptable rather than best", () => {
    // Number.parseFloat("bogus") is NaN; sorting on NaN would be arbitrary.
    expect(preferredLocale("en;q=bogus,es;q=0.4")).toBe("es");
  });

  it("falls back to English for anything unusable", () => {
    for (const header of [undefined, null, "", "   ", "*", "fr-FR,fr;q=0.9", ",,,"]) {
      expect(preferredLocale(header)).toBe("en");
    }
  });
});
