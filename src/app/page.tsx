import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { guestLogin } from "./actions";
import { PasswordForm } from "@/components/PasswordForm";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ArrivalLap } from "@/components/ArrivalLap";
import { Card, DisplayTitle } from "@/components/ui";
import { GUEST_COOKIE, verifyToken } from "@/lib/auth";
import { getTranslation, contactLine, pickOptional } from "@/lib/i18n";
import { safeNext } from "@/lib/nav";
import { getSettings } from "@/lib/settings";

export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // `next` comes straight off the query string, and redirect() will happily
  // send someone to another origin — so it is filtered before either use.
  const next = safeNext((await searchParams).next);

  // Someone who already has the password shouldn't see the gate again.
  if (await verifyToken((await cookies()).get(GUEST_COOKIE)?.value, "guest")) {
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
        <a href="/admin" className="text-xs text-ink-muted transition-colors hover:text-ink">
          {t.gate.hostSignIn}
        </a>
      </div>
    </main>
  );
}
