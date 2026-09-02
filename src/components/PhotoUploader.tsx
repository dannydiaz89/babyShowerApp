"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Alert,
  Button,
  ButtonLink,
  CameraIcon,
  CheckIcon,
  CloseIcon,
  Hint,
  Input,
  Label,
  ProgressBar,
} from "@/components/ui";
import { fill } from "@/lib/i18n/text";
import { prepareImage, UnreadableImageError, type PreparedImage } from "@/lib/image-prep";
import {
  finalizeUpload,
  messageFor,
  openUploadSession,
  putToDrive,
  type PhotosText,
} from "@/lib/photo-client";

/**
 * Pick, review, then upload.
 *
 * Thumbnails and web copies are made on the phone the moment photos are
 * picked, so the whole batch is on screen before a byte moves; nothing
 * uploads until "Add to the photo wall". Each photo then goes up on its
 * own, three at a time, with its own progress and its own cancel, so one
 * slow file never holds the rest.
 *
 * Per photo: open a Drive session, PUT the original straight to Google
 * (skipped when the hosts have no Drive connected), then post the web copy
 * with the Drive id to be recorded.
 */

type Status = "preparing" | "ready" | "unreadable" | "queued" | "uploading" | "done" | "failed";

type Item = {
  key: string;
  file: File;
  thumbUrl: string | null;
  prepared: PreparedImage | null;
  status: Status;
  /** Bytes of the original sent so far. */
  sent: number;
  error: string | null;
  controller: AbortController | null;
};

type Phase = "pick" | "uploading" | "finished";

const CONCURRENCY = 3;
const NAME_KEY = "bs_photo_name";

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string) {
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    // Private mode or storage off: the name just is not remembered.
  }
}

export function PhotoUploader({
  max,
  maxBytes,
  driveConnected,
  t,
}: {
  max: number;
  maxBytes: number;
  driveConnected: boolean;
  t: PhotosText;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [desktop, setDesktop] = useState(false);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const nameHintId = `${nameId}-hint`;
  const keyRef = useRef(0);

  useEffect(() => {
    setName(rememberedName());
    setDesktop(window.matchMedia("(pointer: fine)").matches);
  }, []);

  // Object URLs for the thumbnails are released when the page goes.
  useEffect(() => {
    return () => {
      for (const item of items) if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
  }, []);

  useEffect(() => {
    if (phase !== "uploading") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const patch = useCallback((key: string, change: Partial<Item>) => {
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...change } : i)));
  }, []);

  /* ---------------------------------------------------------- picking */

  /**
   * Decode one photo at a time. Ten 12-megapixel images decoded at once
   * can stall an older phone; one after another, the first thumbnail is
   * on screen almost at once and the rest follow within a second or two.
   */
  const prepareAll = useCallback(
    async (batch: Item[]) => {
      for (const item of batch) {
        try {
          const prepared = await prepareImage(item.file);
          patch(item.key, {
            prepared,
            thumbUrl: URL.createObjectURL(prepared.thumb),
            status: "ready",
          });
        } catch (error) {
          const unreadable = error instanceof UnreadableImageError;
          patch(item.key, {
            status: "unreadable",
            error: unreadable ? fill(t.unreadable, { name: item.file.name }) : t.errFailed,
          });
        }
      }
    },
    [patch, t]
  );

  function pick(list: FileList | File[] | null) {
    if (!list) return;
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    const fresh: string[] = [];

    const room = max - items.filter((i) => i.status !== "unreadable").length;
    const accepted: Item[] = [];
    for (const file of files) {
      if (accepted.length >= room) {
        fresh.push(fill(t.batchFull, { max }));
        break;
      }
      if (file.size > maxBytes) {
        fresh.push(fill(t.tooLarge, { name: file.name, max: Math.round(maxBytes / 1024 / 1024) }));
        continue;
      }
      keyRef.current += 1;
      accepted.push({
        key: `f${keyRef.current}`,
        file,
        thumbUrl: null,
        prepared: null,
        status: "preparing",
        sent: 0,
        error: null,
        controller: null,
      });
    }

    setNotes(fresh);
    if (accepted.length > 0) {
      setItems((current) => [...current, ...accepted]);
      void prepareAll(accepted);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(item: Item) {
    item.controller?.abort();
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
    setItems((current) => current.filter((i) => i.key !== item.key));
  }

  /* -------------------------------------------------------- uploading */

  async function uploadOne(item: Item, uploaderName: string) {
    const controller = new AbortController();
    patch(item.key, { status: "uploading", controller, error: null, sent: 0 });
    try {
      const sessionUrl = await openUploadSession(item.file, controller.signal);

      let driveFileId: string | null = null;
      if (sessionUrl) {
        driveFileId = await putToDrive(
          sessionUrl,
          item.file,
          (sent) => patch(item.key, { sent }),
          controller.signal
        );
      }
      patch(item.key, { sent: item.file.size });

      const prepared = item.prepared!;
      await finalizeUpload(
        {
          web: prepared.web,
          width: prepared.width,
          height: prepared.height,
          driveFileId,
          originalName: item.file.name,
          originalBytes: item.file.size,
          uploaderName,
        },
        controller.signal
      );
      patch(item.key, { status: "done", controller: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      patch(item.key, { status: "failed", controller: null, error: messageFor(error, t) });
    }
  }

  async function submit() {
    const uploaderName = name.trim();
    rememberName(uploaderName);

    const queue = items.filter((i) => i.status === "ready" || i.status === "failed");
    if (queue.length === 0) return;

    setPhase("uploading");
    setItems((current) =>
      current.map((i) => (queue.some((q) => q.key === i.key) ? { ...i, status: "queued" } : i))
    );

    // Three lanes pulling from one queue, so a slow file holds one lane, not all.
    const pending = [...queue];
    const lane = async () => {
      for (;;) {
        const next = pending.shift();
        if (!next) return;
        await uploadOne(next, uploaderName);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, lane));

    setItems((current) => {
      const unfinished = current.some((i) => i.status === "failed" || i.status === "queued");
      setPhase(unfinished ? "uploading" : "finished");
      return current;
    });
  }

  /* --------------------------------------------------------- progress */

  const counted = items.filter((i) => i.status !== "unreadable");
  const uploadable = counted.filter((i) => i.status === "ready" || i.status === "failed");
  const inFlight = counted.some((i) => i.status === "uploading" || i.status === "queued");
  const doneCount = counted.filter((i) => i.status === "done").length;
  const failedCount = counted.filter((i) => i.status === "failed").length;

  let weightTotal = 0;
  let weightDone = 0;
  for (const item of counted) {
    const web = item.prepared?.web.size ?? 0;
    weightTotal += item.file.size + web;
    weightDone += item.status === "done" ? item.file.size + web : Math.min(item.sent, item.file.size);
  }
  const progress = weightTotal > 0 ? weightDone / weightTotal : 0;
  const percent = Math.round(progress * 100);

  /* ----------------------------------------------------------- render */

  if (phase === "finished") {
    return (
      <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center shadow-raised">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-success-soft text-success">
          <CheckIcon className="h-6 w-6" />
        </span>
        <p className="mt-4 font-display text-2xl text-ink">{t.allDone}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {doneCount === 1 ? t.countOne : fill(t.count, { count: doneCount })}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href="/photos" variant="primary">
            {t.seeWall}
          </ButtonLink>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              for (const item of items) if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
              setItems([]);
              setNotes([]);
              setPhase("pick");
            }}
          >
            {t.addMore}
          </Button>
        </div>
      </div>
    );
  }

  const full = counted.length >= max;

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (phase === "pick") pick(e.dataTransfer.files);
        }}
        className={`rounded-xl border-[1.5px] border-dashed bg-surface px-5 py-8 text-center transition-colors sm:py-11 ${
          dragging ? "border-accent bg-accent-soft" : "border-border-field"
        }`}
      >
        <span className="inline-flex h-13 w-13 items-center justify-center rounded-md bg-accent-soft text-accent">
          <CameraIcon className="h-6 w-6" />
        </span>
        <h2 className="mt-3 font-display text-2xl text-ink">{t.chooseTitle}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
          {fill(desktop ? t.chooseBodyDesktop : t.chooseBody, { max })}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          aria-label={t.pickerLabel}
          className="sr-only"
          onChange={(e) => pick(e.target.files)}
          disabled={phase !== "pick" || full}
        />
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={phase !== "pick" || full}
          className="mt-4"
        >
          {desktop ? t.pickDesktop : t.pick}
        </Button>
      </div>

      {notes.length > 0 ? (
        <div role="status" className="space-y-2">
          {notes.map((note) => (
            <Alert key={note} tone="neutral">
              {note}
            </Alert>
          ))}
        </div>
      ) : null}

      <div className="max-w-sm">
        <Label htmlFor={nameId}>
          {t.nameLabel}{" "}
          <span className="font-normal normal-case tracking-normal">{t.nameOptional}</span>
        </Label>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.namePlaceholder}
          maxLength={60}
          autoComplete="name"
          aria-describedby={nameHintId}
          disabled={phase !== "pick"}
        />
        <Hint id={nameHintId}>{t.nameHint}</Hint>
      </div>

      {counted.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label={t.uploadTitle}>
          {items.map((item) => (
            <Thumb
              key={item.key}
              item={item}
              phase={phase}
              onRemove={() => remove(item)}
              onRetry={() => void uploadOne(item, name.trim())}
              t={t}
            />
          ))}
        </ul>
      ) : null}

      <div className="sticky bottom-0 -mx-5 border-t border-border bg-canvas/95 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        {phase === "uploading" ? (
          <>
            <div className="mb-1.5 flex justify-between text-xs text-ink-muted">
              <span>{counted.length === 1 ? t.addingOne : fill(t.addingCount, { count: counted.length })}</span>
              <span>{fill(t.doneOfTotal, { done: doneCount, total: counted.length })}</span>
            </div>
            <ProgressBar value={progress} label={t.uploadTitle} className="mb-3" />
          </>
        ) : counted.length > 0 ? (
          <div className="mb-2 flex justify-between text-xs text-ink-muted">
            <span>{fill(t.ofMax, { count: counted.length, max })}</span>
          </div>
        ) : null}

        {failedCount > 0 && !inFlight ? (
          <Alert tone="critical" className="mb-3" role="alert">
            {fill(t.someFailed, { count: failedCount })}
          </Alert>
        ) : null}

        <Button
          type="button"
          className="w-full"
          onClick={() => void submit()}
          disabled={inFlight || uploadable.length === 0}
        >
          {inFlight
            ? fill(t.submitting, { percent })
            : failedCount > 0
              ? t.retry
              : t.submit}
        </Button>

        <p className="mt-2.5 text-center text-xs text-ink-muted">
          {inFlight ? `${t.keepOpen} ` : ""}
          {driveConnected ? t.originalsNote : t.originalsNoteNoDrive}
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- thumb */

function Thumb({
  item,
  phase,
  onRemove,
  onRetry,
  t,
}: {
  item: Item;
  phase: Phase;
  onRemove: () => void;
  onRetry: () => void;
  t: PhotosText;
}) {
  const percent =
    item.file.size > 0 ? Math.round((Math.min(item.sent, item.file.size) / item.file.size) * 100) : 0;

  const label: Record<Status, string> = {
    preparing: t.statusPreparing,
    ready: t.statusReady,
    unreadable: t.statusFailed,
    queued: t.statusQueued,
    uploading: fill(t.statusUploading, { percent }),
    done: t.statusDone,
    failed: t.statusFailed,
  };

  const tone =
    item.status === "done"
      ? "text-success"
      : item.status === "failed" || item.status === "unreadable"
        ? "text-danger"
        : item.status === "uploading"
          ? "text-accent"
          : "text-ink-muted";

  const removable = item.status !== "done" && (phase === "pick" || item.status !== "queued");

  return (
    <li className="relative aspect-square overflow-hidden rounded-md bg-surface-sunken">
      {item.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL
        <img src={item.thumbUrl} alt={item.file.name} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-surface-sunken motion-reduce:animate-none" />
      )}

      {item.status === "uploading" ? (
        <div className="absolute inset-x-0 top-0 h-1 bg-surface/60">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      ) : null}

      <span
        className={`absolute inset-x-1.5 bottom-1.5 flex items-center gap-1 truncate rounded-sm bg-surface/95 px-1.5 py-1 text-[0.65rem] font-semibold ${tone}`}
        role="status"
      >
        {item.status === "done" ? <CheckIcon className="h-3 w-3" /> : null}
        {label[item.status]}
      </span>

      {item.status === "failed" || item.status === "unreadable" ? (
        <span className="sr-only">{item.error}</span>
      ) : null}

      {item.status === "failed" ? (
        <button
          type="button"
          onClick={onRetry}
          className="absolute left-1.5 top-1.5 rounded-sm bg-surface/95 px-1.5 py-1 text-[0.65rem] font-semibold text-accent"
        >
          {t.retry}
        </button>
      ) : null}

      {removable ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={fill(
            item.status === "uploading" ? t.cancelUpload : t.removeFromBatch,
            { name: item.file.name }
          )}
          className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink/70 text-on-accent hover:bg-ink"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </li>
  );
}
