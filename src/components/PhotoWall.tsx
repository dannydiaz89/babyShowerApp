"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoViewer, type ViewerAction } from "@/components/PhotoViewer";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Modal,
  PlusIcon,
  TrashIcon,
} from "@/components/ui";
import { fill } from "@/lib/i18n/text";
import { justifyRows } from "@/lib/justified";
import {
  deletePhoto,
  fetchWallCount,
  fetchWallPage,
  hidePhoto,
  messageFor,
  restorePhoto,
  type PhotoView,
  type PhotosText,
  type WallFilter,
  type WallPage,
} from "@/lib/photo-client";
import {
  MAX_HEAD_PAGES,
  MAX_REBUILD_PAGES,
  POLL_MIN_MS,
  changeSince,
  countFor,
  newHead,
  nextDelay,
  type Counts,
} from "@/lib/photo-poll";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * The photo wall: justified rows, newest first, more as you scroll.
 *
 * The first page arrives from the server; the rest come through /api/photos
 * as the last row nears the screen. Rows are laid out here, in the browser,
 * because a justified layout needs the container's width and the server
 * does not have it — until the first measurement the wall shows a shimmer
 * row rather than a wrong guess.
 *
 * Guests see live photos and can remove their own. Hosts see whichever
 * filter they chose and can hide, restore, or delete anything.
 */

type Mode = "guest" | "host";

type Confirm = { kind: "remove" | "delete"; photo: PhotoView };

const GAP = 6;

function targetHeight(width: number): number {
  return width < 640 ? 150 : 230;
}

export function PhotoWall({
  initial,
  initialCounts,
  filter,
  mode,
  canUpload,
  t,
  common,
  locale,
}: {
  initial: WallPage;
  /**
   * The wall's tallies and revision, from the same read as `initial` — so the
   * first check knows whether anything has happened since the page rendered.
   */
  initialCounts: Counts;
  filter: WallFilter;
  mode: Mode;
  canUpload: boolean;
  t: PhotosText;
  common: Dictionary["common"];
  locale: string;
}) {
  const [photos, setPhotos] = useState(initial.photos);
  const [cursor, setCursor] = useState(initial.cursor);
  const [done, setDone] = useState(initial.done);
  const [count, setCount] = useState(() => countFor(initialCounts, filter));
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "positive" | "critical"; text: string } | null>(null);

  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [viewing, setViewing] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  /**
   * The host page's counts and filter chips are rendered on the server. A
   * hide, restore or delete changes them, so the server half is refreshed
   * after each; the wall itself has already updated in place.
   */
  const refreshHostPage = useCallback(() => {
    if (mode === "host") router.refresh();
  }, [mode, router]);

  /* ------------------------------------------------------------ layout */

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows =
    width > 0
      ? justifyRows(photos, { containerWidth: width, targetHeight: targetHeight(width), gap: GAP })
      : [];

  /* ----------------------------------------------------------- loading */

  const loadMore = useCallback(async () => {
    if (done || loading || !cursor) return;
    setLoading(true);
    setLoadError(null);
    try {
      const page = await fetchWallPage(cursor, filter);
      setPhotos((current) => {
        // A photo added between two page reads can appear twice; keep the first.
        const seen = new Set(current.map((p) => p.id));
        return [...current, ...page.photos.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.cursor);
      setDone(page.done);
    } catch (error) {
      setLoadError(messageFor(error, t));
    } finally {
      setLoading(false);
    }
  }, [cursor, done, filter, loading, t]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [done, loadMore]);

  /* ------------------------------------------------- photos as they land */

  /*
   * The wall is server-rendered and the browser never talks to Convex — see
   * lib/convex.ts — so there is no subscription to ride on. Instead it asks
   * "how many photos are there?", which is one small document, and reads the
   * wall itself only when that answer moves. Costs nothing on a quiet wall,
   * feels live on a busy one.
   */

  /** The wall as it stands, for callbacks that must not close over a stale copy. */
  const photosRef = useRef(photos);
  /**
   * The revision and counts the wall on screen actually reflects.
   *
   * Seeded from the same read that produced the first page, so the very first
   * check compares against the wall the guest is looking at rather than
   * against nothing. Advanced only when the wall has been brought up to it.
   */
  const appliedRef = useRef<Counts>(initialCounts);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  /**
   * Show a new list without moving the photo someone is looking at.
   *
   * `viewing` is an index, and every one of them shifts when photos are
   * added at the front or taken out of the middle. The open viewer follows
   * its photo by id instead, and closes if that photo has gone — which is
   * what a host hiding the photo you are staring at should do.
   */
  const showPhotos = useCallback((next: PhotoView[]) => {
    setPhotos((current) => {
      setViewing((index) => {
        if (index === null) return null;
        const id = current[index]?.id;
        const moved = id ? next.findIndex((p) => p.id === id) : -1;
        return moved >= 0 ? moved : null;
      });
      return next;
    });
  }, []);

  /**
   * Walk back from the newest photo until reaching one the wall already has.
   *
   * One page covers the ordinary case. A burst larger than a page — three
   * phones emptying their camera rolls between two checks — is why this
   * keeps asking: stopping at one page would leave those photos stranded
   * behind a cursor that has already moved past them, reachable by no amount
   * of scrolling.
   */
  const pullNewest = useCallback(async (): Promise<{ added: PhotoView[]; complete: boolean }> => {
    const known = new Set(photosRef.current.map((p) => p.id));
    const fresh: PhotoView[] = [];
    let cursorAt: string | null = null;

    for (let page = 0; page < MAX_HEAD_PAGES; page++) {
      const got: WallPage = await fetchWallPage(cursorAt, filter);
      const { added, reachedKnown } = newHead(known, got.photos);
      fresh.push(...added);

      if (reachedKnown || got.done || !got.cursor) return { added: fresh, complete: true };
      cursorAt = got.cursor;
    }

    /*
     * Five pages of photos the wall has never seen and still no end in sight.
     * Adding these would leave the ones past them stranded between the last
     * one added and a cursor that has moved beyond both, so the caller starts
     * again from the top instead.
     */
    return { added: fresh, complete: false };
  }, [filter]);

  /**
   * Read the wall again from the top, as far as the guest had scrolled.
   *
   * For when a photo is gone rather than arrived. Nothing fetched from the
   * head can tell us that a photo three pages down has been hidden, so the
   * pages the guest is holding are re-read and replaced wholesale.
   */
  const rebuild = useCallback(async (): Promise<WallPage> => {
    const want = Math.max(photosRef.current.length, 1);
    const collected: PhotoView[] = [];
    let cursorAt: string | null = null;
    let last: WallPage | null = null;

    for (let page = 0; page < MAX_REBUILD_PAGES; page++) {
      const got: WallPage = await fetchWallPage(cursorAt, filter);
      collected.push(...got.photos);
      last = got;

      if (got.done || !got.cursor || collected.length >= want) break;
      cursorAt = got.cursor;
    }

    return { photos: collected, cursor: last?.cursor ?? null, done: last?.done ?? true };
  }, [filter]);

  /*
   * Whether the wall can change while someone is looking at it — which is a
   * different question from whether they may add to it. The hosts' wall
   * shows no upload button, because they moderate there and upload from the
   * guest pages, but it is the wall most in need of watching: everything on
   * it arrives from somebody else. Reading `canUpload` as "nothing will
   * change here" left the hosts reloading to see the party's photos.
   */
  const mayChange = mode === "host" || canUpload;

  useEffect(() => {
    // The week after the shower, when the wall has closed, nobody polls.
    if (!mayChange) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_MIN_MS;
    /*
     * One check at a time, and one timer behind it. Foregrounding a tab fires
     * visibilitychange and focus together and the timer may come due between
     * them; left alone, each event starts a check and a chain of its own, and
     * an evening of switching apps ends up polling several times a tick.
     * Every path goes through `schedule`, which is the only thing that sets a
     * timer and always clears the one before it.
     */
    let running = false;
    let generation = 0;

    const check = async () => {
      // A phone in a pocket, or a tab behind another, asks nothing at all.
      if (stopped || running || document.visibilityState !== "visible") return;

      running = true;
      const mine = ++generation;
      try {
        const counts = await fetchWallCount();
        if (stopped || mine !== generation) return;

        const visible = countFor(counts, filter);
        setCount(visible);

        let change = changeSince(appliedRef.current, counts);
        if (change === "added") {
          const { added, complete } = await pullNewest();
          if (stopped || mine !== generation) return;
          // Too many arrived at once to reach what we already had.
          if (complete) {
            if (added.length > 0) showPhotos([...added, ...photosRef.current]);
          } else {
            change = "rebuild";
          }
        }

        if (change === "rebuild") {
          const page = await rebuild();
          if (stopped || mine !== generation) return;
          showPhotos(page.photos);
          setCursor(page.cursor);
          setDone(page.done);
        }

        /*
         * Only now. Committing the revision before the wall matched it would
         * turn one failed page request into a wall that is permanently a
         * little out of date: the next check would compare against a revision
         * nothing ever caught up to and find nothing to do. An error leaves
         * the old revision in place, so the next check tries again.
         */
        appliedRef.current = counts;
        delay = nextDelay(delay, change !== "none");
      } catch {
        /*
         * Offline, or the wall has closed under us. Neither is worth a
         * message — the wall on screen is still the wall — so it backs off
         * and tries again, and a reload would say so properly.
         */
        delay = nextDelay(delay, false);
      } finally {
        running = false;
      }
    };

    /** The one timer. Setting a new wait always replaces the old one. */
    const schedule = (wait: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(() => void tick(), wait);
    };

    const tick = async () => {
      await check();
      if (!stopped) schedule(delay);
    };
    schedule(delay);

    /*
     * Coming back to the tab is the moment a guest most expects to see what
     * they missed: check at once, from the fast end of the scale. A check
     * already under way owns the schedule and will set the next wait itself,
     * so waking during one does nothing rather than starting a second chain.
     */
    const onWake = () => {
      if (document.visibilityState !== "visible" || running) return;
      delay = POLL_MIN_MS;
      schedule(0);
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [filter, mayChange, pullNewest, rebuild, showPhotos]);

  /* ----------------------------------------------------------- actions */

  function ask(kind: Confirm["kind"], photo: PhotoView) {
    setConfirm({ kind, photo });
    dialogRef.current?.showModal();
  }

  /**
   * What the viewer offers for a photo. A guest can remove their own; a host
   * can hide or restore, and delete for good — the same set as on the tile,
   * so nothing is reachable from one place and not the other.
   */
  function viewerActions(photo: PhotoView): ViewerAction[] {
    if (mode === "guest") {
      return photo.mine
        ? [{ label: t.remove, icon: <TrashIcon />, onClick: () => ask("remove", photo) }]
        : [];
    }
    return [
      photo.status === "hidden"
        ? { label: t.restore, onClick: () => void restore(photo) }
        : { label: t.hostHide, onClick: () => void hideAsHost(photo) },
      {
        label: t.deleteForever,
        icon: <TrashIcon />,
        tone: "danger",
        onClick: () => ask("delete", photo),
      },
    ];
  }

  function dropFromList(id: string) {
    setPhotos((current) => current.filter((p) => p.id !== id));
    setCount((n) => Math.max(0, n - 1));
    setViewing((v) => (v === null ? null : Math.min(v, Math.max(0, photos.length - 2))));
  }

  async function runConfirmed() {
    if (!confirm) return;
    const { kind, photo } = confirm;
    setBusy(true);
    try {
      if (kind === "delete") {
        const result = await deletePhoto(photo.id);
        dropFromList(photo.id);
        if (result.driveDeleted === false) {
          setNotice({ tone: "critical", text: t.driveNotDeleted });
        }
      } else {
        // Only a guest reaches here: a host's hide goes through hideAsHost.
        await hidePhoto(photo.id);
        dropFromList(photo.id);
        setNotice({ tone: "positive", text: t.removed });
      }
      if (viewing !== null && photos.length <= 1) setViewing(null);
      refreshHostPage();
    } catch (error) {
      setNotice({ tone: "critical", text: messageFor(error, t) });
    } finally {
      setBusy(false);
      dialogRef.current?.close();
      setConfirm(null);
    }
  }

  /**
   * A host's hide needs no confirmation: it is reversible from the same
   * page, and the guest-worded "Remove this photo?" dialog would be wrong
   * for a host anyway. Delete for good still asks.
   */
  async function hideAsHost(photo: PhotoView) {
    setBusy(true);
    try {
      await hidePhoto(photo.id);
      if (filter === "live") dropFromList(photo.id);
      else {
        setPhotos((current) =>
          current.map((p) =>
            p.id === photo.id ? { ...p, status: "hidden", hiddenBy: "host", hiddenAt: Date.now() } : p
          )
        );
      }
      refreshHostPage();
    } catch (error) {
      setNotice({ tone: "critical", text: messageFor(error, t) });
    } finally {
      setBusy(false);
    }
  }

  async function restore(photo: PhotoView) {
    setBusy(true);
    try {
      await restorePhoto(photo.id);
      if (filter === "hidden") dropFromList(photo.id);
      else {
        setPhotos((current) =>
          current.map((p) =>
            p.id === photo.id ? { ...p, status: "live", hiddenBy: undefined, hiddenAt: undefined } : p
          )
        );
      }
      refreshHostPage();
    } catch (error) {
      setNotice({ tone: "critical", text: messageFor(error, t) });
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------ render */

  const countLabel = count === 1 ? t.countOne : fill(t.count, { count });

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {countLabel}
        </p>
        {canUpload ? (
          <ButtonLink href="/photos/add" variant="primary" className="shrink-0">
            <PlusIcon />
            {t.add}
          </ButtonLink>
        ) : null}
      </div>

      {notice ? (
        <Alert tone={notice.tone} role="status" className="mb-4">
          {notice.text}
        </Alert>
      ) : null}

      <div ref={containerRef}>
        {photos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-field px-6 py-14 text-center text-sm text-ink-muted">
            {mode === "host" ? (filter === "hidden" ? t.noHidden : t.hostEmpty) : canUpload ? t.empty : t.emptyClosed}
          </p>
        ) : width === 0 ? (
          <Shimmer />
        ) : (
          <div className="flex flex-col" style={{ gap: GAP }}>
            {rows.map((row, r) => (
              <div key={r} className="flex" style={{ gap: GAP, height: row.height }}>
                {row.items.map(({ item: photo, width: w, height: h }) => (
                  <Tile
                    key={photo.id}
                    photo={photo}
                    width={w}
                    height={h}
                    mode={mode}
                    busy={busy}
                    onOpen={() => setViewing(photos.indexOf(photo))}
                    onRemove={() => (mode === "host" ? void hideAsHost(photo) : ask("remove", photo))}
                    onDelete={() => ask("delete", photo)}
                    onRestore={() => restore(photo)}
                    t={t}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      <div className="py-6 text-center text-xs text-ink-muted" aria-live="polite">
        {loadError ? (
          <div className="space-y-3">
            <p className="text-danger">{loadError}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => void loadMore()}>
              {t.loadMore}
            </Button>
          </div>
        ) : loading ? (
          <>
            <Shimmer />
            <p className="mt-3">{t.loadingMore}</p>
          </>
        ) : done && photos.length > 0 ? (
          t.endOfWall
        ) : null}
      </div>

      {viewing !== null && photos[viewing] ? (
        <PhotoViewer
          photos={photos}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onNearEnd={loadMore}
          actionsFor={viewerActions}
          t={t}
          locale={locale}
        />
      ) : null}

      <Modal
        ref={dialogRef}
        titleId="photo-confirm-title"
        title={confirm?.kind === "delete" ? t.deleteTitle : t.removeTitle}
        closeLabel={common.close}
        onClose={() => setConfirm(null)}
        className="z-[60] max-w-md"
      >
        {confirm ? (
          <div
            className="mb-4 overflow-hidden rounded-md bg-surface-sunken"
            style={{ aspectRatio: `${confirm.photo.width} / ${confirm.photo.height}`, maxHeight: 220 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URL */}
            <img src={confirm.photo.url} alt="" className="h-full w-full object-contain" />
          </div>
        ) : null}
        <p className="text-sm leading-relaxed text-ink-muted">
          {confirm?.kind === "delete" ? t.deleteBody : t.removeBody}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
            {confirm?.kind === "delete" ? common.close : t.removeKeep}
          </Button>
          <Button type="button" onClick={() => void runConfirmed()} disabled={busy} autoFocus>
            {confirm?.kind === "delete" ? t.deleteConfirm : t.removeConfirm}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ tile */

function Tile({
  photo,
  width,
  height,
  mode,
  busy,
  onOpen,
  onRemove,
  onDelete,
  onRestore,
  t,
}: {
  photo: PhotoView;
  width: number;
  height: number;
  mode: Mode;
  busy: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onDelete: () => void;
  onRestore: () => void;
  t: PhotosText;
}) {
  const hidden = photo.status === "hidden";
  const control =
    "inline-flex h-8 items-center justify-center gap-1 rounded-md bg-surface/95 px-2 text-xs font-medium " +
    "text-ink shadow-raised transition-colors hover:bg-surface disabled:opacity-60";

  return (
    <div
      className={`group relative shrink-0 overflow-hidden rounded-md bg-surface-sunken ${
        hidden ? "outline-2 outline-dashed outline-danger -outline-offset-2" : ""
      }`}
      style={{ width, height }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={photo.uploaderName ? fill(t.by, { name: photo.uploaderName }) : t.viewerLabel}
        className="block h-full w-full"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URL; sized by the layout, not an optimizer */}
        <img
          src={photo.url}
          alt=""
          width={photo.width}
          height={photo.height}
          loading="lazy"
          decoding="async"
          className={`h-full w-full object-cover ${hidden ? "opacity-50 grayscale" : ""}`}
        />
      </button>

      {photo.uploaderName ? (
        <span className="pointer-events-none absolute bottom-1.5 left-2 max-w-[calc(100%-1rem)] truncate text-[0.7rem] font-medium text-on-viewer [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
          {photo.uploaderName}
        </span>
      ) : null}

      {mode === "guest" && photo.mine ? (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
          <Badge tone="neutral" className="bg-surface/95">
            {t.yours}
          </Badge>
          <button
            type="button"
            onClick={onRemove}
            aria-label={t.remove}
            title={t.remove}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-surface/95 text-danger shadow-raised hover:bg-surface"
          >
            <TrashIcon />
          </button>
        </div>
      ) : null}

      {mode === "host" ? (
        <>
          {hidden ? (
            <Badge tone="critical" className="absolute left-1.5 top-1.5">
              {photo.hiddenBy === "host" ? t.hiddenByHost : t.hiddenByGuest}
            </Badge>
          ) : null}
          {/* Always visible: a control that only appears on hover is one a
              host on a phone never finds, and on a laptop is easy to miss. */}
          <div className="absolute bottom-1.5 right-1.5 flex gap-1">
            {hidden ? (
              <button type="button" onClick={onRestore} disabled={busy} className={control}>
                {t.restore}
              </button>
            ) : (
              <button type="button" onClick={onRemove} disabled={busy} className={control}>
                {t.hostHide}
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              aria-label={t.deleteForever}
              title={t.deleteForever}
              className={`${control} text-danger`}
            >
              <TrashIcon />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Placeholder rows while the width is unknown or the next page is on its way. */
function Shimmer() {
  return (
    <div aria-hidden="true" className="flex gap-1.5">
      {[1.4, 0.8, 1.1].map((ratio, i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none"
          style={{ flex: ratio }}
        />
      ))}
    </div>
  );
}
