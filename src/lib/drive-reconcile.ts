/**
 * Which files in the Drive folder are nobody's.
 *
 * A phone PUTs an original straight to Drive, then records it. Anything that
 * arrives in the folder and is never recorded — a batch abandoned mid-way, a
 * finalize that failed, or someone with the guest password uploading
 * originals on purpose and never finishing — is a file with no photo on the
 * wall and nothing a host could delete from the site. This picks those out.
 *
 * Pure, so the rule that deletes files from the hosts' Drive is tested
 * without Google in the loop. The grace period is what keeps it safe: an
 * upload still in flight on a slow connection is not an orphan yet.
 */

export type FolderFile = { id: string; createdTime: string };

/** How long a file may sit unrecorded before it is treated as abandoned. */
export const RECONCILE_GRACE_MS = 30 * 60 * 1000;

/** How often the folder is looked at, at most. */
export const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;

/** The most deletions one run will do; the next run picks up the rest. */
export const RECONCILE_MAX_DELETES = 200;

export function orphansToDelete(
  files: FolderFile[],
  recorded: ReadonlySet<string>,
  now: number,
  graceMs: number = RECONCILE_GRACE_MS,
  maxDeletes: number = RECONCILE_MAX_DELETES
): string[] {
  const orphans: string[] = [];
  for (const file of files) {
    if (recorded.has(file.id)) continue;
    const created = Date.parse(file.createdTime);
    // An unreadable time is left alone: better a stray file than a wrong delete.
    if (!Number.isFinite(created) || now - created < graceMs) continue;
    orphans.push(file.id);
    if (orphans.length >= maxDeletes) break;
  }
  return orphans;
}
