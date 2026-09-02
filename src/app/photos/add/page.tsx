import { redirect } from "next/navigation";
import { GuestHeader } from "@/components/SiteHeader";
import { PhotoUploader } from "@/components/PhotoUploader";
import { PageTitle } from "@/components/ui";
import {
  PHOTO_BATCH_MAX,
  PHOTO_ORIGINAL_MAX_BYTES,
  PHOTO_WEB_MAX_BYTES,
} from "../../../../convex/limits";
import { getTranslation } from "@/lib/i18n";
import { wallState, webMaxEdgeFor } from "@/lib/photos";
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

  // A pause holds for everyone, hosts included: the storage is not ready.
  // A merely closed wall a host can still test.
  if (wall.paused || (!wall.uploads && !previewing)) {
    redirect(wall.visible ? "/photos" : "/invitation");
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
        {/*
          * A plain anchor, not next/link, on purpose: a client-side navigation
          * never fires beforeunload, so a guest leaving mid-batch would lose
          * the uploads in flight without the warning the page sets up.
          */}
        <a
          href="/photos"
          className="mb-3 inline-block py-1 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <span aria-hidden="true">&larr; </span>
          {t.photos.backToWall}
        </a>
        <PageTitle className="mb-6">{t.photos.uploadTitle}</PageTitle>
        <PhotoUploader
          max={PHOTO_BATCH_MAX}
          maxBytes={PHOTO_ORIGINAL_MAX_BYTES}
          maxWebBytes={PHOTO_WEB_MAX_BYTES}
          maxEdge={webMaxEdgeFor(settings.photoStorage)}
          keepsOriginals={settings.photoStorage === "drive"}
          t={t.photos}
        />
      </main>
    </>
  );
}
