import { headers } from "next/headers";
import { SettingsForm, type DrivePanel } from "@/components/SettingsForm";
import type { InviteCard } from "@/components/InviteLink";
import { PageTitle } from "@/components/ui";
import { AdminHeader } from "@/components/SiteHeader";
import { PHOTO_STORAGE_CAP_BYTES } from "../../../../convex/limits";
import { formatBytes } from "@/components/StorageNotice";
import { getDriveConnection, googleConfigured, type DriveConnection } from "@/lib/google-drive";
import { fill, formatDateShort, getTranslation } from "@/lib/i18n";
import { defaultClosesISO } from "@/lib/photo-wall";
import { storageStatus, wallState } from "@/lib/photos";
import { invitePath } from "@/lib/invite";
import { qrCode } from "@/lib/qr";
import { getSettings } from "@/lib/settings";
import { originFrom } from "@/lib/site-origin";
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
  /*
   * Both credentials are pulled out by name before the rest is handed to the
   * form. What is left is what the hosts may edit; a secret that rides along
   * in a spread ends up in the page's HTML without anyone deciding it should.
   * The invite code does go to the browser — below, deliberately, because the
   * hosts have to see their own link.
   */
  const { guestPasswordHash, inviteCode, isConfigured, ...settings } = stored;
  void isConfigured;

  const origin = originFrom(await headers()) ?? "";
  const invite: InviteCard[] = inviteCode
    ? [
        {
          url: `${origin}${invitePath(inviteCode)}`,
          title: t.settings.inviteCardInvitation,
          hint: t.settings.inviteCardInvitationHint,
          file: "invitation-qr",
          qr: qrCode(`${origin}${invitePath(inviteCode)}`),
        },
        {
          url: `${origin}${invitePath(inviteCode, "/photos")}`,
          title: t.settings.inviteCardPhotos,
          hint: t.settings.inviteCardPhotosHint,
          file: "photo-wall-qr",
          qr: qrCode(`${origin}${invitePath(inviteCode, "/photos")}`),
        },
      ]
    : [];

  const initialTab = SETTINGS_TABS.includes(params.tab as SettingsTab)
    ? (params.tab as SettingsTab)
    : "event";

  const configured = googleConfigured();
  let connection: DriveConnection | null = null;
  if (configured) {
    try {
      connection = await getDriveConnection();
    } catch (error) {
      console.error("Reading the Drive connection failed", error);
    }
  }
  const [status, wall] = await Promise.all([storageStatus(), wallState()]);

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
    healthy: { ok: true, text: t.settings.driveNoticeHealthy },
    stillfailing: { ok: false, text: t.settings.driveNoticeStillFailing },
  };

  const drive: DrivePanel = {
    configured,
    connection,
    notice: params.drive ? (notices[params.drive] ?? null) : null,
    eventDate: formatDateShort(settings.startISO, locale),
    defaultCloses: defaultClosesISO(settings.startISO, settings.endISO),
    status,
    paused: wall.paused,
    capLabel: formatBytes(PHOTO_STORAGE_CAP_BYTES),
    locale,
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
          invite={invite}
          inviteKnown={stored.available}
          drive={drive}
          initialTab={initialTab}
        />
      </main>
    </>
  );
}
