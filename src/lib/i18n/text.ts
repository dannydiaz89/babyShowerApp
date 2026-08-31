/**
 * Pure text and date helpers — no next/headers, so client components can use
 * them. Anything needing the request (getLocale, getTranslation) stays in
 * ./index.ts, which re-exports everything here for server callers.
 */
import type { Localized } from "@/lib/defaults";
import type { Locale } from "./locales";

export type { Locale };

/** Fill {placeholders} in a dictionary string. */
export function fill(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match
  );
}

/** Host-written text, falling back to English when the Spanish is blank. */
export function pick(text: Localized, locale: Locale): string {
  const value = text[locale]?.trim();
  return value ? value : (text.en ?? "").trim();
}

/**
 * One definition of "the host left this empty", so every optional field on
 * the site hides the same way instead of rendering a labelled blank.
 */
export function present(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Localised text if the host filled it in, otherwise null. */
export function pickOptional(
  text: Localized | undefined,
  locale: Locale
): string | null {
  if (!text) return null;
  const value = pick(text, locale);
  return present(value) ? value : null;
}

const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-MX" };

/** "Saturday, October 18, 2026" / "sábado, 18 de octubre de 2026" */
export function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/** "October 1, 2026" / "1 de octubre de 2026" — no weekday, for deadlines. */
export function formatDateShort(iso: string, locale: Locale): string {
  // A bare "YYYY-MM-DD" parses as UTC, which can land on the previous day in
  // western time zones. Adding a time pins it to local.
  const date = new Date(iso.includes("T") ? iso : `${iso}T12:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * "2:00 PM – 5:00 PM", or just "2:00 PM" when no end time is set.
 * Returns null when there is no usable start, so the caller can hide the line
 * rather than print a half-formed range.
 */
export function formatTimeRange(
  startISO: string,
  endISO: string,
  locale: Locale
): string | null {
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return null;

  const format = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: "numeric",
    minute: "2-digit",
  });

  const end = new Date(endISO);
  if (Number.isNaN(end.getTime())) return format.format(start);

  return `${format.format(start)} – ${format.format(end)}`;
}

/**
 * Contact lines mention a name, an email, or both. Picking the phrasing from
 * whichever the hosts actually filled in avoids "Text  or email ." — and
 * avoids hiding a perfectly useful name just because no email was given.
 */
export function contactLine(
  templates: { both: string; nameOnly: string; emailOnly: string },
  name: string | undefined,
  email: string | undefined
): string | null {
  const hasName = present(name);
  const hasEmail = present(email);

  if (hasName && hasEmail) return fill(templates.both, { name: name!, email: email! });
  if (hasName) return fill(templates.nameOnly, { name: name! });
  if (hasEmail) return fill(templates.emailOnly, { email: email! });
  return null;
}
