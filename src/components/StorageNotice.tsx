import { Alert, AnchorButton, Button, ProgressBar } from "@/components/ui";
import { fill } from "@/lib/i18n/text";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { DriveConnection } from "@/lib/google-drive";
import type { PauseReason, StorageStatus } from "@/lib/photo-wall";

/**
 * What the hosts need to know about the storage behind the wall, in one
 * place: the meter for the site's storage, and the reason uploads are
 * paused when they are, with the ways out. Shown on the Photos settings
 * tab and the host photo page; the dashboard carries a one-line pointer.
 */

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes <= 0) return "0 KB";
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const WARN_AT = 0.8;

export function StorageNotice({
  status,
  paused,
  connection,
  t,
  locale,
  /** Offer the ways out here, rather than a link to where they are. */
  withActions = false,
}: {
  status: StorageStatus;
  paused: PauseReason | null;
  connection: DriveConnection | null;
  t: Dictionary;
  locale: string;
  withActions?: boolean;
}) {
  const ratio = status.cap > 0 ? status.bytes / status.cap : 0;
  const time = (at: number | null) =>
    at
      ? new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-US", {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(at))
      : "";

  let problem: string | null = null;
  switch (paused) {
    case "storage-full":
      problem = t.photos.storageFullHost;
      break;
    case "drive-failing":
      problem = fill(t.photos.driveFailingHost, { time: time(connection?.failedAt ?? null) });
      break;
    case "drive-revoked":
      problem = fill(t.photos.driveRevokedHost, { time: time(connection?.failedAt ?? null) });
      break;
    case "drive-unconnected":
      problem = t.photos.driveUnconnectedHost;
      break;
  }

  return (
    <div className="space-y-3">
      {problem ? (
        <Alert tone="critical" role="alert">
          <p>{problem}</p>
          {connection?.failureMessage && paused !== "storage-full" ? (
            <p className="mt-1 text-xs opacity-80">
              {fill(t.photos.driveLastError, { message: connection.failureMessage })}
            </p>
          ) : null}
          {withActions && paused && paused !== "storage-full" ? (
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
          ) : !withActions ? (
            <p className="mt-2">
              <a href="/admin/settings?tab=photos" className="underline underline-offset-4">
                {t.photos.goToSettings}
              </a>
            </p>
          ) : null}
        </Alert>
      ) : ratio >= WARN_AT ? (
        <Alert tone="critical" role="status">
          {t.photos.storageWarning}
        </Alert>
      ) : null}

      <div>
        <ProgressBar value={ratio} label={t.settings.storageTitle} />
        <p className="mt-1.5 text-xs text-ink-muted tabular-nums">
          {fill(t.photos.storageMeter, {
            used: formatBytes(status.bytes),
            cap: formatBytes(status.cap),
          })}
        </p>
      </div>
    </div>
  );
}
