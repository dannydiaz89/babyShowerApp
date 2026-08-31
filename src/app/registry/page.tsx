import { GuestHeader } from "@/components/SiteHeader";
import { Moon } from "@/components/Moon";
import { Card, cardClass, PageTitle } from "@/components/ui";
import { getTranslation, fill, pickOptional, present, formatDateShort } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { isAdminSession } from "@/lib/session";

/**
 * Registry accents. Tailwind needs whole class names, so the palette is a
 * fixed map rather than an interpolated string.
 */
const ACCENT_STYLES: Record<string, string> = {
  sage: "bg-accent-soft text-accent",
  clay: "bg-registry-clay text-registry-clay-ink",
  amber: "bg-registry-amber text-gold-ink",
  sky: "bg-registry-sky text-registry-sky-ink",
};

export default async function RegistryPage() {
  const [{ locale, t }, settings, previewing] = await Promise.all([
    getTranslation(),
    getSettings(),
    isAdminSession(),
  ]);

  return (
    <>
      <GuestHeader current="/registry" babyName={settings.babyName} locale={locale} t={t} previewing={previewing} />

      <main id="main" className="mx-auto max-w-3xl px-5 pb-20 pt-12">
        <div className="mb-9 text-center">
          <Moon className="mx-auto h-9 w-9 text-accent" />
          <PageTitle className="mt-4">{t.registry.title}</PageTitle>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
            {fill(t.registry.blurb, { names: settings.honorees })}
          </p>
        </div>

        <ul className="grid gap-4">
          {settings.registries.map((registry) => (
            <li key={registry.url}>
              <a
                href={registry.url}
                target="_blank"
                rel="noreferrer"
                className={`${cardClass} group flex items-center justify-between gap-5 px-6 py-6 transition-shadow hover:shadow-overlay`}
              >
                <span className="flex items-center gap-4">
                  <span
                    aria-hidden="true"
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md font-display text-xl ${
                      ACCENT_STYLES[registry.accent] ?? ACCENT_STYLES.sage
                    }`}
                  >
                    {registry.name.charAt(0)}
                  </span>
                  <span>
                    <span className="block font-display text-xl text-ink">
                      {registry.name}
                    </span>
                    {pickOptional(registry.description, locale) ? (
                      <span className="mt-0.5 block text-sm leading-relaxed text-ink-muted">
                        {pickOptional(registry.description, locale)}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-accent transition-transform group-hover:translate-x-0.5">
                  {t.registry.open}
                  <span aria-hidden="true"> &rarr;</span>
                  <span className="sr-only"> ({t.registry.opensInNewTab})</span>
                </span>
              </a>
            </li>
          ))}
        </ul>

        {present(settings.giftShippingAddress) ? (
          <Card className="mt-6 px-6 py-6 text-center">
            <p className="text-sm leading-relaxed text-ink-muted">
              {fill(t.registry.shipping, {
                address: settings.giftShippingAddress,
                date: formatDateShort(settings.startISO, locale),
              })}
            </p>
          </Card>
        ) : null}
      </main>
    </>
  );
}
