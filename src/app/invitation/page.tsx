import { GuestHeader } from "@/components/SiteHeader";
import { Moon } from "@/components/Moon";
import {
  AnchorButton,
  ButtonLink,
  Card,
  DisplayTitle,
  Eyebrow,
  Overline,
  OrnamentRule,
  SectionTitle,
} from "@/components/ui";
import {
  getTranslation,
  fill,
  contactLine,
  pick,
  pickOptional,
  present,
  formatDate,
  formatDateShort,
  formatTimeRange,
} from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { isAdminSession } from "@/lib/session";

/** Google Calendar wants UTC as YYYYMMDDTHHMMSSZ. */
function calendarStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * The end time is optional for the hosts, but Google Calendar requires one.
 * Assume a two-hour event when it isn't set, rather than emitting a malformed
 * date range that silently produces a broken link.
 */
function calendarRange(startISO: string, endISO: string): string | null {
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return null;

  const parsedEnd = new Date(endISO);
  const end = Number.isNaN(parsedEnd.getTime())
    ? new Date(start.getTime() + 2 * 60 * 60 * 1000)
    : parsedEnd;

  return `${calendarStamp(start)}/${calendarStamp(end)}`;
}

export default async function InvitationPage() {
  const [{ locale, t }, settings, previewing] = await Promise.all([
    getTranslation(),
    getSettings(),
    isAdminSession(),
  ]);

  const eventDate = formatDate(settings.startISO, locale);
  const timeRange = formatTimeRange(settings.startISO, settings.endISO, locale);

  const dates = calendarRange(settings.startISO, settings.endISO);
  const calendarParams = new URLSearchParams({
    action: "TEMPLATE",
    text: `${settings.babyName} — ${t.invitation.title}`,
    ...(dates ? { dates } : {}),
    details: pick(settings.tagline, locale) || "",
    location: settings.address,
  });

  const tagline = pickOptional(settings.tagline, locale);
  const dressCode = pickOptional(settings.dressCode, locale);
  const notes = pickOptional(settings.notes, locale);

  /**
   * The invitation card gets more air beneath it than the cards below it give
   * one another, so whichever card lands first takes the wider gap.
   */
  const gap = (isFirst: boolean) => (isFirst ? "mt-8" : "mt-4");

  const contact = contactLine(
    {
      both: t.invitation.questions,
      nameOnly: t.invitation.questionsNameOnly,
      emailOnly: t.invitation.questionsEmailOnly,
    },
    settings.contactName,
    settings.contactEmail
  );

  return (
    <>
      <GuestHeader current="/invitation" babyName={settings.babyName} locale={locale} t={t} previewing={previewing} />

      <main id="main" className="mx-auto max-w-3xl px-5 pb-20 pt-12">
        <Card as="section" className="px-6 py-12 text-center sm:px-12 sm:py-16">
          <Eyebrow>{t.invitation.eyebrow}</Eyebrow>

          <DisplayTitle className="mt-5 text-[2.75rem] sm:text-6xl">
            {t.invitation.title}
            <span className="mt-1 block text-2xl text-ink-muted sm:text-3xl">
              {fill(t.invitation.honoring, { names: settings.honorees })}
            </span>
          </DisplayTitle>

          <div className="mx-auto mt-8 max-w-xs">
            <OrnamentRule>
              <Moon className="h-6 w-6 shrink-0" />
            </OrnamentRule>
          </div>

          {tagline ? (
            <p className="mx-auto mt-8 max-w-md font-display text-xl text-ink-muted sm:text-2xl">
              {tagline}
            </p>
          ) : null}

          <p className={`font-display text-2xl text-accent sm:text-3xl ${tagline ? "mt-6" : "mt-8"}`}>
            {eventDate}
          </p>
          {timeRange ? (
            <p className="mt-1 text-base text-ink-muted">{timeRange}</p>
          ) : null}

          {present(settings.venueName) ? (
            <p className="mt-6 text-lg text-ink">{settings.venueName}</p>
          ) : null}
          {present(settings.address) ? (
            <p className="text-sm text-ink-muted">{settings.address}</p>
          ) : null}
          {present(settings.venueName) || present(settings.address) ? (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(settings.mapsQuery)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block py-2 text-sm text-accent underline underline-offset-4"
            >
              {t.invitation.openInMaps}
              <span className="sr-only"> ({t.registry.opensInNewTab})</span>
            </a>
          ) : null}

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/rsvp" variant="primary" className="w-full sm:w-auto">
              {t.invitation.rsvpCta}
            </ButtonLink>
            {dates ? (
            <AnchorButton
              href={`https://calendar.google.com/calendar/render?${calendarParams}`}
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto"
            >
              {t.invitation.addToCalendar}
              <span className="sr-only"> ({t.registry.opensInNewTab})</span>
            </AnchorButton>
            ) : null}
          </div>

          <p className="mt-5 text-xs text-ink-muted">
            {fill(t.invitation.respondBy, {
              date: formatDateShort(settings.rsvpDeadlineISO, locale),
            })}
          </p>
        </Card>

        {dressCode ? (
          <Card as="section" className={`${gap(true)} px-6 py-5`}>
            <Overline as="h2" className="mb-1.5">
              {t.invitation.whatToWear}
            </Overline>
            <p className="text-sm leading-relaxed text-ink">{dressCode}</p>
          </Card>
        ) : null}

        {notes ? (
          <Card as="section" className={`${gap(!dressCode)} px-6 py-6`}>
            <Overline as="h2" className="mb-1.5">
              {t.invitation.aFewNotes}
            </Overline>
            <p className="text-sm leading-relaxed text-ink">{notes}</p>
          </Card>
        ) : null}

        {settings.registries.length > 0 ? (
        <Card
          as="section"
          className={`${gap(!dressCode && !notes)} flex flex-col items-start justify-between gap-4 px-6 py-6 sm:flex-row sm:items-center`}
        >
          <div>
            <SectionTitle className="text-xl">{t.invitation.registryTitle}</SectionTitle>
            <p className="text-sm text-ink-muted">{t.invitation.registryBlurb}</p>
          </div>
          <ButtonLink href="/registry" className="shrink-0">
            {t.invitation.viewRegistries}
          </ButtonLink>
        </Card>
        ) : null}

        {contact ? (
          <p className="mt-10 text-center text-xs text-ink-muted">{contact}</p>
        ) : null}
      </main>
    </>
  );
}
