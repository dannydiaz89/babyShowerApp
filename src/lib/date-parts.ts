/*
 * Dates are handled as plain Y-M-D parts, never as a Date built from a string.
 * `new Date("2026-11-07")` parses as UTC and can land on the previous day west
 * of Greenwich — the kind of bug that silently moves an event by a day.
 *
 * Kept out of the DateField component so the parsing rules can be tested
 * directly: they decide what an event date actually gets saved as.
 */

export type DateParts = { year: number; month: number; day: number };

export function toISO({ year, month, day }: DateParts): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function firstWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 1)).getUTCDay();
}

/** Is this a day that exists? 2026-02-31 is not. */
function isRealDate(year: number, month1: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month1) || !Number.isInteger(day)) {
    return false;
  }
  if (month1 < 1 || month1 > 12 || day < 1) return false;
  return day <= daysInMonth(year, month1 - 1);
}

/**
 * Read a stored "YYYY-MM-DD" value.
 *
 * Shape alone is not enough: an impossible day has to be rejected here as well
 * as in typed input, or the field displays the date the calendar rolls it into
 * while saving the one that was written.
 */
export function fromISO(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [year, month1, day] = [+match[1], +match[2], +match[3]];
  if (!isRealDate(year, month1, day)) return null;

  return { year, month: month1 - 1, day };
}

/** Does this locale write the day before the month? */
export function dayComesFirst(locale: string): boolean {
  const order = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  })
    .formatToParts(Date.UTC(2021, 4, 17))
    .filter((part) => part.type === "day" || part.type === "month")
    .map((part) => part.type);
  return order[0] === "day";
}

/**
 * Read what the host typed. Accepts the locale's own order (11/07/2026 in the
 * US, 07/11/2026 in Mexico), any of / - . as separators, and plain ISO.
 * Returns null when it isn't a real date, so 31/02 is rejected rather than
 * quietly rolling into March.
 */
export function parseTyped(text: string, locale: string): DateParts | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const iso = fromISO(trimmed);
  if (iso) return iso;
  // An ISO-shaped string that isn't a real date is a mistake, not something to
  // reinterpret as the locale's day/month order.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const numbers = trimmed.split(/[/\-.\s]+/).filter(Boolean).map(Number);
  if (numbers.length !== 3 || numbers.some(Number.isNaN)) return null;

  const [a, b, rawYear] = numbers;
  const [day, month] = dayComesFirst(locale) ? [a, b] : [b, a];
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;

  if (!isRealDate(year, month, day)) return null;

  return { year, month: month - 1, day };
}

export function formatParts(parts: DateParts | null, locale: string): string {
  if (!parts) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(parts.year, parts.month, parts.day));
}
