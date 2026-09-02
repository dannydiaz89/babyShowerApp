import { describe, expect, it } from "vitest";
import { orphansToDelete, RECONCILE_GRACE_MS } from "../../src/lib/drive-reconcile";

/**
 * The rule that deletes files from the hosts' Drive. It has to be exact:
 * a file with a photo on the wall must never go, and an upload still in
 * flight must be given time, while what nobody recorded does go once it
 * has had its grace.
 */

const NOW = Date.parse("2026-11-07T20:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

describe("orphansToDelete", () => {
  it("never picks a file a photo points at, however old", () => {
    const files = [{ id: "a", createdTime: at(600) }];
    expect(orphansToDelete(files, new Set(["a"]), NOW)).toEqual([]);
  });

  it("leaves an unrecorded file alone inside the grace period", () => {
    const files = [{ id: "fresh", createdTime: at(5) }];
    expect(orphansToDelete(files, new Set(), NOW)).toEqual([]);
  });

  it("picks an unrecorded file once its grace has passed", () => {
    const files = [{ id: "stale", createdTime: at(RECONCILE_GRACE_MS / 60_000 + 1) }];
    expect(orphansToDelete(files, new Set(), NOW)).toEqual(["stale"]);
  });

  it("sorts a mixed folder correctly", () => {
    const files = [
      { id: "recorded-old", createdTime: at(120) },
      { id: "orphan-old", createdTime: at(90) },
      { id: "orphan-new", createdTime: at(2) },
      { id: "recorded-new", createdTime: at(1) },
    ];
    expect(orphansToDelete(files, new Set(["recorded-old", "recorded-new"]), NOW)).toEqual(["orphan-old"]);
  });

  it("leaves a file with an unreadable time alone", () => {
    expect(orphansToDelete([{ id: "x", createdTime: "yesterday" }], new Set(), NOW)).toEqual([]);
  });

  it("stops at the per-run cap and leaves the rest for the next run", () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, createdTime: at(100) }));
    expect(orphansToDelete(files, new Set(), NOW, RECONCILE_GRACE_MS, 3)).toHaveLength(3);
  });
});
