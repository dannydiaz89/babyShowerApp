/**
 * The browser's side of the photo routes.
 *
 * No server imports: this runs in client components. Types come from the
 * Convex module as types only, so nothing of the backend ships to the phone.
 */
import type { PhotoView, WallFilter } from "../../convex/photos";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { isPhotoErrorCode, type PhotoErrorCode } from "@/lib/photo-codes";

export type { PhotoView, WallFilter };
export type PhotosText = Dictionary["photos"];
export type WallPage = { photos: PhotoView[]; cursor: string | null; done: boolean };

/** A route said no, or could not be reached at all. */
export class PhotoApiError extends Error {
  constructor(
    public readonly code: PhotoErrorCode | "offline",
    public readonly status: number
  ) {
    super(code);
    this.name = "PhotoApiError";
  }
}

/** The reader's-language sentence for a refusal. */
export function messageFor(error: unknown, t: PhotosText): string {
  const code = error instanceof PhotoApiError ? error.code : "failed";
  switch (code) {
    case "signed-out":
      return t.errSignedOut;
    case "closed":
      return t.errClosed;
    case "rate-limited":
      return t.errRateLimited;
    case "too-large":
      return t.errTooLarge;
    case "bad-request":
      return t.errBadRequest;
    case "drive":
      return t.errDrive;
    case "not-found":
      return t.errNotFound;
    case "forbidden":
      return t.errForbidden;
    case "offline":
      return t.errOffline;
    default:
      return t.errFailed;
  }
}

async function call<T>(input: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, { credentials: "same-origin", ...init });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new PhotoApiError("offline", 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new PhotoApiError(
      isPhotoErrorCode(body.error) ? body.error : "failed",
      response.status
    );
  }
  return (await response.json()) as T;
}

/* ----------------------------------------------------------------- wall */

export function fetchWallPage(cursor: string | null, filter: WallFilter = "live") {
  const params = new URLSearchParams({ filter });
  if (cursor) params.set("cursor", cursor);
  return call<WallPage>(`/api/photos?${params}`);
}

export function hidePhoto(id: string) {
  return call<{ ok: true }>(`/api/photos/${encodeURIComponent(id)}/hide`, { method: "POST" });
}

export function restorePhoto(id: string) {
  return call<{ ok: true }>(`/api/photos/${encodeURIComponent(id)}/restore`, { method: "POST" });
}

export function deletePhoto(id: string) {
  return call<{ ok: true; driveDeleted: boolean | null }>(
    `/api/photos/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

/* --------------------------------------------------------------- upload */

/** Where the original should go, or null when the hosts have no Drive connected. */
export async function openUploadSession(file: File, signal?: AbortSignal): Promise<string | null> {
  const { sessionUrl } = await call<{ sessionUrl: string | null }>("/api/photos/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
    signal,
  });
  return sessionUrl;
}

/**
 * Send the original straight to Google.
 *
 * XMLHttpRequest rather than fetch, for one reason: fetch reports nothing
 * about upload progress, and a guest on venue Wi-Fi watching a 6 MB photo go
 * up deserves to see it move. The session URL carries its own authorisation,
 * so no header of ours goes with it.
 */
export function putToDrive(
  sessionUrl: string,
  file: File,
  onProgress: (sentBytes: number) => void,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onerror = () => reject(new PhotoApiError("drive", xhr.status || 0));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        return reject(new PhotoApiError("drive", xhr.status));
      }
      try {
        const { id } = JSON.parse(xhr.responseText) as { id?: string };
        if (!id) throw new Error("no id");
        resolve(id);
      } catch {
        reject(new PhotoApiError("drive", xhr.status));
      }
    };

    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export async function finalizeUpload(
  {
    web,
    width,
    height,
    driveFileId,
    originalName,
    originalBytes,
    uploaderName,
  }: {
    web: Blob;
    width: number;
    height: number;
    driveFileId: string | null;
    originalName: string;
    originalBytes: number;
    uploaderName: string;
  },
  signal?: AbortSignal
): Promise<PhotoView> {
  const form = new FormData();
  form.append("web", web, "web");
  form.append("width", String(width));
  form.append("height", String(height));
  if (driveFileId) form.append("driveFileId", driveFileId);
  form.append("originalName", originalName);
  form.append("originalBytes", String(originalBytes));
  if (uploaderName) form.append("uploaderName", uploaderName);

  const { photo } = await call<{ photo: PhotoView }>("/api/photos", {
    method: "POST",
    body: form,
    signal,
  });
  return photo;
}
