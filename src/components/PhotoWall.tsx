"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoViewer } from "@/components/PhotoViewer";
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
  fetchWallPage,
  hidePhoto,
  messageFor,
  restorePhoto,
  type PhotoView,
  type PhotosText,
  type WallFilter,
  type WallPage,
} from "@/lib/photo-client";
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
  total,
  filter,
  mode,
  canUpload,
  t,
  common,
  locale,
}: {
  initial: WallPage;
  /** How many photos match `filter` in all, for the header. */
  total: number;
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
  const [count, setCount] = useState(total);
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

  /* ----------------------------------------------------------- actions */

  const canRemove = useCallback(
    (photo: PhotoView) => mode === "host" || photo.mine,
    [mode]
  );

  function ask(kind: Confirm["kind"], photo: PhotoView) {
    setConfirm({ kind, photo });
    dialogRef.current?.showModal();
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
        await hidePhoto(photo.id);
        if (mode === "guest" || filter === "live") {
          dropFromList(photo.id);
          if (mode === "guest") setNotice({ tone: "positive", text: t.removed });
        } else {
          setPhotos((current) =>
            current.map((p) =>
              p.id === photo.id ? { ...p, status: "hidden", hiddenBy: "host" } : p
            )
          );
        }
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
                    canRemove={canRemove(photo)}
                    onOpen={() => setViewing(photos.indexOf(photo))}
                    onRemove={() => ask("remove", photo)}
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
          canRemove={canRemove}
          onRemove={(photo) => ask(mode === "host" ? "delete" : "remove", photo)}
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
  canRemove,
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
  canRemove: boolean;
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

      {mode === "guest" && canRemove ? (
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
          <div className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
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
