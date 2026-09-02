import { SettingsForm, type DrivePanel } from "@/components/SettingsForm";
import { PageTitle } from "@/components/ui";
import { AdminHeader } from "@/components/SiteHeader";
import { getDriveConnection, googleConfigured } from "@/lib/google-drive";
import { fill, formatDateShort, getTranslation } from "@/lib/i18n";
import { defaultClosesISO } from "@/lib/photo-wall";
import { getSettings } from "@/lib/settings";
import { SETTINGS_TABS, type SettingsTab } from "@/lib/settings-tabs";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; drive?: string }>;
}) {
  const [{ locale, t }, stored, params] = await Promise.all([
    getTranslation(),
    getSettings(),
    searchParams,
  ]);
  const { guestPasswordHash, isConfigured, ...settings } = stored;
  void isConfigured;

  const initialTab = SETTINGS_TABS.includes(params.tab as SettingsTab)
    ? (params.tab as SettingsTab)
    : "event";

  const configured = googleConfigured();
  let connection: DrivePanel["connection"] = null;
  if (configured) {
    try {
      const row = await getDriveConnection();
      if (row) connection = { account: row.account, folderName: row.folderName, folderUrl: row.folderUrl };
    } catch (error) {
      console.error("Reading the Drive connection failed", error);
    }
  }

  // The word the Google routes send back, turned into a sentence.
  const notices: Record<string, { ok: boolean; text: string }> = {
    connected: {
      ok: true,
      text: fill(t.settings.driveNoticeConnected, { folder: connection?.folderName ?? "" }),
    },
    disconnected: { ok: true, text: t.settings.driveNoticeDisconnected },
    denied: { ok: false, text: t.settings.driveNoticeDenied },
    error: { ok: false, text: t.settings.driveNoticeError },
    unconfigured: { ok: false, text: t.settings.driveUnconfigured },
  };

  const drive: DrivePanel = {
    configured,
    connection,
    notice: params.drive ? (notices[params.drive] ?? null) : null,
    eventDate: formatDateShort(settings.startISO, locale),
    defaultCloses: defaultClosesISO(settings.startISO, settings.endISO),
  };

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
          drive={drive}
          initialTab={initialTab}
        />
      </main>
    </>
  );
}
