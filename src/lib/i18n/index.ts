import { cookies, headers } from "next/headers";
import { en, es, type Dictionary } from "./dictionaries";
import { LOCALES, isLocale, preferredLocale } from "./locales";
import type { Locale } from "./locales";

export type { Dictionary };


export const LOCALE_COOKIE = "bs_lang";

const DICTIONARIES: Record<Locale, Dictionary> = { en, es };

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/**
 * The reader's language: their explicit choice if they've made one, otherwise
 * the best match from the browser, otherwise English.
 */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;

  return preferredLocale((await headers()).get("accept-language"));
}

/** Locale plus its dictionary, which is what pages actually need. */
export async function getTranslation(): Promise<{ locale: Locale; t: Dictionary }> {
  const locale = await getLocale();
  return { locale, t: dictionaryFor(locale) };
}


export { LOCALES, isLocale, preferredLocale };
export * from "./text";
