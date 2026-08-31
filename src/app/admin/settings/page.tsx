import { SettingsForm } from "@/components/SettingsForm";
import { PageTitle } from "@/components/ui";
import { AdminHeader } from "@/components/SiteHeader";
import { getTranslation } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [{ locale, t }, stored] = await Promise.all([getTranslation(), getSettings()]);
  const { guestPasswordHash, isConfigured, ...settings } = stored;
  void isConfigured;

  return (
    <>
      <AdminHeader
        current="/admin/settings"
        babyName={stored.babyName}
        locale={locale}
        t={t}
      />


      <main id="main" className="mx-auto max-w-4xl px-5 pb-20 pt-10">
        <div className="mb-8">
          <PageTitle>{t.settings.title}</PageTitle>
          <p className="mt-2 max-w-md text-sm text-ink-muted">{t.settings.intro}</p>
        </div>

        <SettingsForm
          settings={settings}
          t={t}
          locale={locale}
          hasStoredPassword={Boolean(guestPasswordHash)}
        />
      </main>
    </>
  );
}
