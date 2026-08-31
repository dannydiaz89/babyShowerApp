import { setLocale } from "@/app/actions";
import { SegmentedControl, Segment } from "@/components/ui";
import { LOCALES, dictionaryFor, type Locale } from "@/lib/i18n";

/** Language names are written in their own language, never translated. */
const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

export function LanguageToggle({
  locale,
  currentPath,
  className = "",
}: {
  locale: Locale;
  currentPath: string;
  className?: string;
}) {
  const t = dictionaryFor(locale);

  return (
    <form action={setLocale} className={className}>
      <input type="hidden" name="next" value={currentPath} />
      <SegmentedControl label={t.nav.language}>
        {LOCALES.map((code) => (
          <Segment
            key={code}
            type="submit"
            name="locale"
            value={code}
            lang={code}
            // Left enabled on purpose: some screen readers skip disabled
            // controls, and this is the one that says which language you're on.
            selected={code === locale}
          >
            {LOCALE_NAMES[code]}
          </Segment>
        ))}
      </SegmentedControl>
    </form>
  );
}
