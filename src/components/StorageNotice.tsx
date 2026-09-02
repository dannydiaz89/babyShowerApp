import { Alert, AnchorButton, Button, ProgressBar } from "@/components/ui";
import { fill } from "@/lib/i18n/text";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { DriveConnection } from "@/lib/google-drive";
import type { PauseReason, StorageStatus } from "@/lib/photo-wall";

/**
 * What the hosts need to know about the storage behind the wall, in two
 * pieces that belong in two places: the meter for the site's own storage,
 * which sits with the "this site" choice, and the Drive pause notice, which
 * sits with the Drive connection. Keeping them apart is the point — a meter
 * inside the Drive card reads as a Drive quota, and it is not one.
 */

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes <= 0) return "0 KB";
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const WARN_AT = 0.8;

/** The site's storage: how full it is, and a warning or a stop when that matters. */
export function StorageMeter({
  status,
  paused,
  t,
}: {
  status: StorageStatus;
  paused: PauseReason | null;
  t: Dictionary;
}) {
  const ratio = status.cap > 0 ? status.bytes / status.cap : 0;
  return (
    <div className="space-y-2">
      {paused === "storage-full" ? (
        <Alert tone="critical" role="alert">
          {t.photos.storageFullHost}
        </Alert>
      ) : ratio >= WARN_AT ? (
        <Alert tone="critical" role="status">
          {t.photos.storageWarning}
        </Alert>
      ) : null}
      <ProgressBar value={ratio} label={t.settings.storageSite} />
      <p className="text-xs text-ink-muted tabular-nums">
        {fill(t.photos.storageMeter, {
          used: formatBytes(status.bytes),
          cap: formatBytes(status.cap),
        })}
      </p>
    </div>
  );
}

/** Why Drive is holding uploads up, if it is, and the ways out. */
export function DrivePauseNotice({
  paused,
  connection,
  t,
  locale,
  /** Offer the ways out here, rather than a link to where they are. */
  withActions = false,
}: {
  paused: PauseReason | null;
  connection: DriveConnection | null;
  t: Dictionary;
  locale: string;
  withActions?: boolean;
}) {
  if (!paused || paused === "storage-full") return null;

  const time = (at: number | null) =>
    at
      ? new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-US", {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(at))
      : "";

  const problem =
    paused === "drive-failing"
      ? fill(t.photos.driveFailingHost, { time: time(connection?.failedAt ?? null) })
      : paused === "drive-revoked"
        ? fill(t.photos.driveRevokedHost, { time: time(connection?.failedAt ?? null) })
        : t.photos.driveUnconnectedHost;

  return (
    <Alert tone="critical" role="alert">
      <p>{problem}</p>
      {connection?.failureMessage ? (
        <p className="mt-1 text-xs opacity-80">
          {fill(t.photos.driveLastError, { message: connection.failureMessage })}
        </p>
      ) : null}
      {withActions ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {paused === "drive-failing" ? (
            <form method="post" action="/api/google/check">
              <Button type="submit" variant="secondary" size="sm">
                {t.settings.driveCheck}
              </Button>
            </form>
          ) : null}
          <AnchorButton href="/api/google/start" variant="secondary" size="sm">
            {paused === "drive-unconnected" ? t.settings.driveConnect : t.settings.driveReconnect}
          </AnchorButton>
        </div>
      ) : (
        <p className="mt-2">
          <a href="/admin/settings?tab=photos" className="underline underline-offset-4">
            {t.photos.goToSettings}
          </a>
        </p>
      )}
    </Alert>
  );
}
