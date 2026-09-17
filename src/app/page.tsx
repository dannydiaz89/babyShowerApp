import { redirect } from "next/navigation";
import { guestLogin } from "./actions";
import { PasswordForm } from "@/components/PasswordForm";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ArrivalLap } from "@/components/ArrivalLap";
import { Alert, Card, DisplayTitle } from "@/components/ui";
import { hasCurrentGuestCookie } from "@/lib/session";
import { getTranslation, contactLine, pickOptional } from "@/lib/i18n";
import { safeNext } from "@/lib/nav";
import { getSettings } from "@/lib/settings";

export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; link?: string }>;
}) {
  const query = await searchParams;
  // `next` comes straight off the query string, and redirect() will happily
  // send someone to another origin — so it is filtered before either use.
  const next = safeNext(query.next);
  /*
   * Set by /i/<code> when a scanned link did not work: a code the hosts have
   * replaced, or too many tries from this address. Compared against a literal
   * rather than echoed, so nothing from the URL reaches the page.
   */
  const staleLink = query.link === "stale";

  /*
   * Someone who already has the password shouldn't see the gate again — but
   * "already has" has to mean what the pages behind this one mean by it. A
   * cookie that predates the last password change is signed and unexpired and
   * still refused everywhere else, so sending it onward only bounces it
   * straight back here.
   */
  if (await hasCurrentGuestCookie()) {
    redirect(next);
  }

  const [{ locale, t }, settings] = await Promise.all([getTranslation(), getSettings()]);

  const tagline = pickOptional(settings.tagline, locale);
  const contact = contactLine(
    {
      both: t.gate.lostPassword,
      nameOnly: t.gate.lostPasswordNameOnly,
      emailOnly: t.gate.lostPasswordEmailOnly,
    },
    settings.contactName,
    settings.contactEmail
  );

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <Card className="w-full max-w-sm px-7 py-9 text-center">
        <ArrivalLap replayLabel={t.gate.replay} />

        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.28em] text-ink-muted">
          {t.gate.eyebrow}
        </p>
        <DisplayTitle className="mt-2 text-3xl">{settings.babyName}</DisplayTitle>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {tagline ? `${tagline}. ` : ""}
          {t.gate.intro}
        </p>

        {staleLink ? (
          <Alert tone="critical" role="status" className="mt-5 text-left">
            {t.gate.linkStale}
          </Alert>
        ) : null}

        <div className="mt-7 text-left">
          <PasswordForm
            action={guestLogin}
            next={next}
            label={t.gate.submit}
            pendingLabel={t.gate.checking}
            fieldLabel={t.gate.passwordLabel}
            placeholder={t.gate.passwordPlaceholder}
            errorPrefix={t.common.errorPrefix}
          />
        </div>

        {contact ? (
          <p className="mt-6 text-xs leading-relaxed text-ink-muted">{contact}</p>
        ) : null}
      </Card>

      <div className="mt-6 flex flex-col items-center gap-4">
        <LanguageToggle locale={locale} currentPath="/" />
        <div className="flex items-center gap-4 text-xs text-ink-muted">
          <a href="/privacy" className="transition-colors hover:text-ink">
            {t.privacy.title}
          </a>
          <span aria-hidden="true">·</span>
          <a href="/admin" className="transition-colors hover:text-ink">
            {t.gate.hostSignIn}
          </a>
        </div>
      </div>
    </main>
  );
}
