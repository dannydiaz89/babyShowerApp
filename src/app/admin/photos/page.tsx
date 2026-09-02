import { AdminHeader } from "@/components/SiteHeader";
import { PhotoWall } from "@/components/PhotoWall";
import { DrivePauseNotice, StorageMeter } from "@/components/StorageNotice";
import { Alert, ButtonLink, PageTitle } from "@/components/ui";
import { getDriveConnection, googleConfigured, scheduleReconcile } from "@/lib/google-drive";
import { fill, getTranslation } from "@/lib/i18n";
import {
  loadTotals,
  loadWallPage,
  scheduleStorageSweep,
  storageStatus,
  wallState,
  type WallFilter,
} from "@/lib/photos";
import { getSettings } from "@/lib/settings";

/*
 * The hosts' view of the wall: everything guests added, including what they
 * removed, with restore and delete-for-good. The filter is a plain query
 * parameter, so a host can bookmark "hidden" and see at a glance what
 * needs a decision.
 */

export const dynamic = "force-dynamic";

const FILTERS: WallFilter[] = ["all", "live", "hidden"];

function filterParam(value: string | undefined): WallFilter {
  return FILTERS.includes(value as WallFilter) ? (value as WallFilter) : "all";
}

export default async function AdminPhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const [{ locale, t }, settings, params] = await Promise.all([
    getTranslation(),
    getSettings(),
    searchParams,
  ]);
  const filter = filterParam(params.filter);

  let page: Awaited<ReturnType<typeof loadWallPage>> | null = null;
  let totals = { live: 0, hidden: 0, bytes: 0 };
  try {
    [page, totals] = await Promise.all([
      loadWallPage({ filter, cursor: null, viewerId: null }),
      loadTotals(),
    ]);
  } catch (error) {
    console.error("Loading the photo wall failed", error);
  }

  const [wall, status, connection] = await Promise.all([
    wallState(),
    storageStatus(),
    settings.photoStorage === "drive" && googleConfigured()
      ? getDriveConnection().catch(() => null)
      : Promise.resolve(null),
  ]);
  if (connection) await scheduleReconcile(connection);
  await scheduleStorageSweep();

  const counts: Record<WallFilter, number> = {
    all: totals.live + totals.hidden,
    live: totals.live,
    hidden: totals.hidden,
  };
  const labels: Record<WallFilter, string> = {
    all: t.photos.filterAll,
    live: t.photos.filterLive,
    hidden: t.photos.filterHidden,
  };

  return (
    <>
      <AdminHeader current="/admin/photos" babyName={settings.babyName} locale={locale} t={t} />

      <main id="main" className="mx-auto max-w-6xl px-3 pb-20 pt-8 sm:px-5 sm:pt-10">
        <div className="px-2 sm:px-0">
          <PageTitle>{t.photos.hostTitle}</PageTitle>
          <p className="mt-2 max-w-xl text-sm text-ink-muted">{t.photos.hostIntro}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {fill(t.photos.stats, { live: totals.live, hidden: totals.hidden })}
          </p>

          <div className="mt-4 max-w-xl space-y-3">
            <DrivePauseNotice paused={wall.paused} connection={connection} t={t} locale={locale} />
            <StorageMeter status={status} paused={wall.paused} t={t} />
          </div>

          <nav aria-label={t.photos.filterLabel} className="mt-5 flex flex-wrap gap-2">
            {FILTERS.map((name) => (
              <ButtonLink
                key={name}
                href={name === "all" ? "/admin/photos" : `/admin/photos?filter=${name}`}
                variant={name === filter ? "primary" : "secondary"}
                size="sm"
                aria-current={name === filter ? "page" : undefined}
              >
                {labels[name]}
                <span className="tabular-nums opacity-80">{counts[name]}</span>
              </ButtonLink>
            ))}
          </nav>
        </div>

        <div className="mt-5">
          {page ? (
            <PhotoWall
              key={filter}
              initial={page}
              total={counts[filter]}
              filter={filter}
              mode="host"
              canUpload={false}
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
