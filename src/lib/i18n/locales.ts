/**
 * The locale list, its type, and the pure logic for choosing one.
 *
 * Deliberately free of next/headers so both halves of the i18n layer — and
 * the tests — can import it. Anything needing the request lives in ./index.ts.
 */
export const LOCALES = ["en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported language out of an Accept-Language header.
 *
 * The header is a quality-ranked list, not an ordered one: "en;q=0.5,es;q=0.9"
 * asks for Spanish first even though English is written first. Reading only the
 * leading tag gets that backwards, and mishandles "fr,es;q=0.9,en;q=0.5" too —
 * that reader prefers Spanish over English and should not be handed English
 * just because an unsupported language happens to come first.
 */
export function preferredLocale(header: string | null | undefined): Locale {
  const ranked = (header ?? "")
    .split(",")
    .map((part, order) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return {
        // "es-MX" and "es" both mean Spanish to us; we have no regional copy.
        base: tag.trim().toLowerCase().split("-")[0],
        // A malformed q is treated as unacceptable rather than best-quality.
        quality: Number.isFinite(quality) ? quality : 0,
        order,
      };
    })
    // q=0 explicitly means "not acceptable".
    .filter((entry) => entry.base && entry.quality > 0)
    // Equal quality keeps header order, which is what writing them in order means.
    .sort((a, b) => b.quality - a.quality || a.order - b.order);

  // A loop rather than .find(): the type predicate on isLocale narrows the
  // value here, but would not narrow through the property of a found entry.
  for (const entry of ranked) {
    if (isLocale(entry.base)) return entry.base;
  }
  return "en";
}
