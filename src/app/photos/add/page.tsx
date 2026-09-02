import { redirect } from "next/navigation";
import { GuestHeader } from "@/components/SiteHeader";
import { PhotoUploader } from "@/components/PhotoUploader";
import { PageTitle } from "@/components/ui";
import { PHOTO_BATCH_MAX, PHOTO_ORIGINAL_MAX_BYTES } from "../../../../convex/limits";
import { getDriveConnection, googleConfigured } from "@/lib/google-drive";
import { getTranslation } from "@/lib/i18n";
import { wallState } from "@/lib/photos";
import { getSettings } from "@/lib/settings";
import { isAdminSession, requireGuestAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AddPhotosPage() {
  await requireGuestAccess("/photos/add");

  const [{ locale, t }, settings, previewing, wall] = await Promise.all([
    getTranslation(),
    getSettings(),
    isAdminSession(),
    wallState(),
  ]);

  // Closed to guests; a host can still test the flow.
  if (!wall.uploads && !previewing) redirect(wall.visible ? "/photos" : "/invitation");

  // Only decides which note the guest reads under the button; the upload
  // itself asks again per photo, so a connection made mid-batch still counts.
  let driveConnected = false;
  if (googleConfigured()) {
    try {
      driveConnected = (await getDriveConnection()) !== null;
    } catch (error) {
      console.error("Reading the Drive connection failed", error);
    }
  }

  return (
    <>
      <GuestHeader
        current="/photos"
        babyName={settings.babyName}
        locale={locale}
        t={t}
        previewing={previewing}
        photos
      />

      <main id="main" className="mx-auto max-w-2xl px-5 pb-10 pt-8 sm:pt-10">
        <PageTitle className="mb-6">{t.photos.uploadTitle}</PageTitle>
        <PhotoUploader
          max={PHOTO_BATCH_MAX}
          maxBytes={PHOTO_ORIGINAL_MAX_BYTES}
          driveConnected={driveConnected}
          t={t.photos}
        />
      </main>
    </>
  );
}
