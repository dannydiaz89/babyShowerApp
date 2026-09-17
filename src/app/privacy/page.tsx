import type { Metadata } from "next";
import Link from "next/link";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Moon } from "@/components/Moon";
import { Card, Overline, PageTitle } from "@/components/ui";
import { contactLine, fill, formatDateShort, getTranslation } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";

/**
 * The one page outside the password gate.
 *
 * Guests deserve it — they are handing over a phone number and photographs of
 * their children — and Google requires a public privacy policy before an
 * OAuth app may leave testing, which is what keeps the Drive connection alive
 * for longer than a week. Middleware gates the four guest paths by name, so
 * this one is public without any change there; keep it that way.
 *
 * Everything on it is checked against what the code does. When the data the
 * app keeps changes, this changes with it.
 */

export const metadata: Metadata = {
  // The rest of the site is noindex; this page has to be reachable, but there
  // is still no reason to list a private family's shower in a search engine.
  robots: { index: false, follow: false },
};

/** When the text below was last true. Shown to the reader, not derived. */
const UPDATED_ISO = "2026-09-17";

export default async function PrivacyPage() {
  const [{ locale, t }, settings] = await Promise.all([getTranslation(), getSettings()]);

  const sections = [
    { title: t.privacy.rsvpTitle, body: t.privacy.rsvpBody },
    { title: t.privacy.photosTitle, body: t.privacy.photosBody },
    { title: t.privacy.cookiesTitle, body: t.privacy.cookiesBody },
    { title: t.privacy.addressTitle, body: t.privacy.addressBody },
    { title: t.privacy.seenTitle, body: fill(t.privacy.seenBody, { names: settings.honorees }) },
    { title: t.privacy.keptTitle, body: t.privacy.keptBody },
    { title: t.privacy.deleteTitle, body: t.privacy.deleteBody },
  ];

  /*
   * The invitation's wording, not the gate's: someone reading this wants to
   * ask about their data, not recover a password.
   */
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
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 py-12">
      <Card className="px-7 py-10 sm:px-10">
        <Moon className="h-8 w-8 text-accent" />
        <PageTitle className="mt-5">{t.privacy.title}</PageTitle>
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          {fill(t.privacy.intro, { names: settings.honorees })}
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          {fill(t.privacy.updated, { date: formatDateShort(UPDATED_ISO, locale) })}
        </p>

        <div className="mt-9 space-y-7">
          {sections.map((section) => (
            <section key={section.title}>
              <Overline as="h2">{section.title}</Overline>
              <p className="mt-2 text-sm leading-relaxed text-ink">{section.body}</p>
            </section>
          ))}
        </div>

        {contact ? (
          <p className="mt-9 border-t border-border pt-6 text-sm leading-relaxed text-ink-muted">
            {contact}
          </p>
        ) : null}
      </Card>

      <div className="mt-6 flex flex-col items-center gap-4">
        <LanguageToggle locale={locale} currentPath="/privacy" />
        <Link href="/" className="text-xs text-ink-muted transition-colors hover:text-ink">
          {t.privacy.backToInvitation}
        </Link>
      </div>
    </main>
  );
}
