"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "@/components/ui";
import { fill } from "@/lib/i18n/text";
import type { PhotoView, PhotosText } from "@/lib/photo-client";

/**
 * One photo at a time, full screen, in the wall's order.
 *
 * Swipe or the arrows move through it; on a keyboard, the arrow keys and
 * Escape. Tapping the photo hides the controls so it can be looked at clean.
 * Nearing the end asks the wall for its next page, so a guest can flip
 * through everything without closing.
 *
 * The one dark surface in the app: a photograph reads best against it.
 */
/** One thing the reader may do to the photo on screen. */
export type ViewerAction = {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  /** Destructive actions are marked so the eye can tell them apart. */
  tone?: "neutral" | "danger";
};

export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
  onNearEnd,
  actionsFor,
  t,
  locale,
}: {
  photos: PhotoView[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Called when the reader is a few photos from the last one loaded. */
  onNearEnd: () => void;
  /** What this reader may do to a given photo: remove, hide, restore, delete. */
  actionsFor: (photo: PhotoView) => ViewerAction[];
  t: PhotosText;
  locale: string;
}) {
  const photo = photos[index];
  const [controls, setControls] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= photos.length) return;
      onIndex(next);
    },
    [index, photos.length, onIndex]
  );

  useEffect(() => {
    if (photos.length - index <= 4) onNearEnd();
  }, [index, photos.length, onNearEnd]);

  // Keyboard, focus and scroll lock, for as long as the viewer is open.
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [go, onClose]);

  if (!photo) return null;

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") return;
    touch.current = { x: event.clientX, y: event.clientY, at: Date.now() };
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // A quick, mostly-horizontal movement is a swipe; anything smaller a tap.
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - start.at < 800) {
      go(dx < 0 ? 1 : -1);
    }
  };

  const positionLabel = fill(t.position, { index: index + 1, count: photos.length });
  const taken = new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(photo.createdAt));

  const arrow =
    "absolute top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-md " +
    "bg-on-viewer/15 text-on-viewer transition-opacity hover:bg-on-viewer/25 disabled:opacity-30";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.viewerLabel}
      className="fixed inset-0 z-50 flex flex-col bg-viewer text-on-viewer"
    >
      <div
        className={`flex shrink-0 items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)] text-sm text-on-viewer-muted transition-opacity ${
          controls ? "" : "pointer-events-none opacity-0"
        }`}
      >
        <span aria-live="polite">{positionLabel}</span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-on-viewer/15 text-on-viewer hover:bg-on-viewer/25"
        >
          <CloseIcon />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2 touch-pan-y"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={() => setControls((c) => !c)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served from Convex storage; no optimizer in the loop */}
        <img
          key={photo.id}
          src={photo.url}
          alt={photo.uploaderName ? fill(t.by, { name: photo.uploaderName }) : ""}
          width={photo.width}
          height={photo.height}
          draggable={false}
          className="max-h-full max-w-full select-none rounded-sm object-contain"
        />

        <button
          type="button"
          aria-label={t.previous}
          disabled={index === 0}
          onClick={(event) => {
            event.stopPropagation();
            go(-1);
          }}
          className={`${arrow} left-3 ${controls ? "" : "pointer-events-none opacity-0"}`}
        >
          <ChevronLeftIcon />
        </button>
        <button
          type="button"
          aria-label={t.next}
          disabled={index >= photos.length - 1}
          onClick={(event) => {
            event.stopPropagation();
            go(1);
          }}
          className={`${arrow} right-3 ${controls ? "" : "pointer-events-none opacity-0"}`}
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div
        className={`shrink-0 px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-3 transition-opacity ${
          controls ? "" : "pointer-events-none opacity-0"
        }`}
      >
        {photo.uploaderName ? (
          <p className="text-[0.95rem] font-medium">{photo.uploaderName}</p>
        ) : null}
        <p className="text-xs text-on-viewer-muted">{taken}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={photo.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md bg-on-viewer/15 px-3.5 py-2.5 text-sm font-medium text-on-viewer hover:bg-on-viewer/25"
          >
            {t.openFull}
          </a>
          {actionsFor(photo).map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2.5 text-sm font-medium text-on-viewer hover:bg-on-viewer/25 ${
                action.tone === "danger" ? "bg-danger/60" : "bg-on-viewer/15"
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-[0.7rem] text-on-viewer-muted">{t.tapToToggle}</p>
      </div>
    </div>
  );
}
