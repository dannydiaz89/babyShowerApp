import { redirect } from "next/navigation";
import { GuestHeader } from "@/components/SiteHeader";
import { PhotoWall } from "@/components/PhotoWall";
import { Alert, PageTitle } from "@/components/ui";
import { getTranslation } from "@/lib/i18n";
import { currentUploaderId, loadTotals, loadWallPage, wallState } from "@/lib/photos";
import { getSettings } from "@/lib/settings";
import { isAdminSession, requireGuestAccess } from "@/lib/session";

// New photos arrive while the page is open; never serve this from a cache.
export const dynamic = "force-dynamic";

export default async function PhotosPage() {
  await requireGuestAccess("/photos");

  const [{ locale, t }, settings, previewing, wall, viewerId] = await Promise.all([
    getTranslation(),
    getSettings(),
    isAdminSession(),
    wallState(),
    currentUploaderId(),
  ]);

  // Before the hosts open the wall there is nothing here for a guest. A host
  // previewing the site can still see it, since it is theirs to open.
  if (!wall.visible && !previewing) redirect("/invitation");

  let page: Awaited<ReturnType<typeof loadWallPage>> | null = null;
  let live = 0;
  try {
    const [first, totals] = await Promise.all([
      loadWallPage({ filter: "live", cursor: null, viewerId }),
      loadTotals(),
    ]);
    page = first;
    live = totals.live;
  } catch (error) {
    console.error("Loading the photo wall failed", error);
  }

  // A host may test a closed wall, but not one whose storage is not ready.
  const canUpload = wall.uploads || (previewing && !wall.paused);

  return (
    <>
      <GuestHeader
        current="/photos"
        babyName={settings.babyName}
        locale={locale}
        t={t}
        previewing={previewing}
        photos={wall.visible || previewing}
      />

      <main id="main" className="mx-auto max-w-5xl px-3 pb-20 pt-8 sm:px-5 sm:pt-10">
        <div className="px-2 sm:px-0">
          <PageTitle>{t.photos.title}</PageTitle>
          {wall.paused ? (
            <Alert tone="neutral" role="status" className="mt-3 max-w-xl">
              {wall.paused === "storage-full"
                ? t.photos.fullNotice
                : previewing
                  ? t.photos.pausedNoticeHost
                  : t.photos.pausedNotice}
              {previewing ? (
                <>
                  {" "}
                  <a href="/admin/settings?tab=photos" className="underline underline-offset-4">
                    {t.photos.goToSettings}
                  </a>
                </>
              ) : null}
            </Alert>
          ) : !wall.uploads ? (
            <p className="mt-2 text-sm text-ink-muted">{t.photos.closedNotice}</p>
          ) : null}
        </div>

        <div className="mt-5">
          {page ? (
            <PhotoWall
              initial={page}
              total={live}
              filter="live"
              mode="guest"
              canUpload={canUpload}
              t={t.photos}
              common={t.common}
              locale={locale}
            />
          ) : (
            <Alert tone="critical" role="alert">
              {t.photos.loadFailed}
            </Alert>
          )}
        </div>
      </main>
    </>
  );
}
