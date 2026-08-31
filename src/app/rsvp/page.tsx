import { GuestHeader } from "@/components/SiteHeader";
import { RsvpForm } from "@/components/RsvpForm";
import { Eyebrow, PageTitle } from "@/components/ui";
import { getTranslation, fill, pick, formatDate, formatDateShort } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { isAdminSession } from "@/lib/session";

export default async function RsvpPage() {
  const [{ locale, t }, settings, previewing] = await Promise.all([
    getTranslation(),
    getSettings(),
    isAdminSession(),
  ]);

  return (
    <>
      <GuestHeader current="/rsvp" babyName={settings.babyName} locale={locale} t={t} previewing={previewing} />

      <main id="main" className="mx-auto max-w-2xl px-5 pb-20 pt-12">
        <div className="mb-8 text-center">
          <Eyebrow>{formatDate(settings.startISO, locale)}</Eyebrow>
          <PageTitle className="mt-3">{t.rsvp.title}</PageTitle>
          <p className="mt-3 text-sm text-ink-muted">
            {fill(t.rsvp.intro, {
              date: formatDateShort(settings.rsvpDeadlineISO, locale),
            })}
          </p>
        </div>

        <RsvpForm
          t={t}
          honorees={settings.honorees}
          eventDate={formatDate(settings.startISO, locale)}
          mealOptions={settings.mealOptions.map((option) => pick(option, locale))}
          askMeal={settings.askMeal}
          allowKids={settings.allowKids}
          collectPhone={settings.collectPhone}
        />
      </main>
    </>
  );
}
