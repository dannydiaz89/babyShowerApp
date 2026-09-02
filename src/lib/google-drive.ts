import "server-only";
import { cache } from "react";
import { after } from "next/server";
import { api } from "../../convex/_generated/api";
import { convexClient, convexKey } from "@/lib/convex";
import {
  orphansToDelete,
  RECONCILE_INTERVAL_MS,
  RECONCILE_MAX_DELETES,
  RECONCILE_PAGES_PER_RUN,
  RECONCILE_TIME_BUDGET_MS,
  type FolderFile,
} from "@/lib/drive-reconcile";
import { RECORDED_IDS_BATCH } from "../../convex/photos";
import { open, seal } from "@/lib/seal";

/**
 * The hosts' Google Drive, where guest photos are kept at full quality.
 *
 * Connected once, from Settings, with the hosts' own Google account and the
 * `drive.file` scope: the app can create files and folders and reach those
 * again, and nothing else in the Drive. A service account was rejected —
 * files it uploads are its own, count against its own quota, and cannot be
 * handed to a personal Gmail account.
 *
 * The refresh token is the only durable credential. It is sealed under
 * AUTH_SECRET before it reaches the database (src/lib/seal.ts) and only ever
 * opened here, on the server. Access tokens are short-lived and kept in
 * memory.
 *
 * This is the only file that talks to Google.
 */

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

/** Carries the OAuth `state` between /api/google/start and the callback. */
export const STATE_COOKIE = "bs_gstate";

/** Long enough for Google on a slow day, short enough not to hang a request. */
const TIMEOUT_MS = 15_000;

export class DriveError extends Error {
  constructor(
    message: string,
    /** "revoked" means the hosts must reconnect; anything else is transient. */
    public readonly kind: "revoked" | "unavailable" | "config" = "unavailable"
  ) {
    super(message);
    this.name = "DriveError";
  }
}

/* -------------------------------------------------------------- settings */

/** Whether the Google OAuth client is configured at all. */
export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function clientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new DriveError("GOOGLE_CLIENT_ID is not set.", "config");
  return id;
}

function clientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new DriveError("GOOGLE_CLIENT_SECRET is not set.", "config");
  return secret;
}

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new DriveError("AUTH_SECRET is not set.", "config");
  return s;
}

/* ----------------------------------------------------------------- oauth */

/** Where to send a host to grant access. `state` is checked on the way back. */
export function authorizationUrl({
  redirectUri,
  state,
}: {
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    // A refresh token is only issued for offline access, and only on a
    // consent screen — so both are forced, even for a reconnect.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    // invalid_grant: the hosts revoked access, or the token expired unused.
    const kind = json.error === "invalid_grant" ? "revoked" : "unavailable";
    throw new DriveError(json.error_description ?? json.error ?? "Token request failed.", kind);
  }
  return json;
}

/** Trade the code Google sends back for tokens. */
export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const json = await postToken({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (!json.access_token || !json.refresh_token) {
    throw new DriveError("Google did not return a refresh token. Try connecting again.");
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

/** The email on the account that granted access, so Settings can show it. */
export async function accountEmail(accessToken: string): Promise<string> {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new DriveError("Could not read the Google account.");
  const json = (await response.json()) as { email?: string };
  return json.email ?? "Google account";
}

/* ------------------------------------------------------------ connection */

export type DriveHealth = {
  health: "ok" | "failing";
  failureKind: "unavailable" | "revoked" | null;
  failureMessage: string | null;
  failedAt: number | null;
  lastCheckedAt: number | null;
};

export type DriveConnection = DriveHealth & {
  account: string;
  folderId: string;
  folderName: string;
  folderUrl: string;
  connectedAt: number;
  lastReconciledAt: number | null;
  reconcileCursor: string | null;
};

type StoredConnection = DriveConnection & { refreshTokenSealed: string };

async function storedConnection(): Promise<StoredConnection | null> {
  const row = await convexClient().query(api.drive.get, { key: convexKey() });
  if (!row) return null;
  return {
    account: row.account,
    folderId: row.folderId,
    folderName: row.folderName,
    folderUrl: row.folderUrl,
    connectedAt: row.connectedAt,
    refreshTokenSealed: row.refreshTokenSealed,
    health: row.health ?? "ok",
    failureKind: row.failureKind ?? null,
    failureMessage: row.failureMessage ?? null,
    failedAt: row.failedAt ?? null,
    lastCheckedAt: row.lastCheckedAt ?? null,
    lastReconciledAt: row.lastReconciledAt ?? null,
    reconcileCursor: row.reconcileCursor ?? null,
  };
}

/* ---------------------------------------------------------------- health */

/**
 * Remember that Google did not answer, so uploads pause instead of every
 * guest finding out one photo at a time. Anything that is not a DriveError
 * is treated as "unavailable": a timeout or a network fault looks the same
 * from here and heals the same way.
 */
export async function recordDriveFailure(error: unknown): Promise<void> {
  const kind = error instanceof DriveError && error.kind === "revoked" ? "revoked" : "unavailable";
  const message = error instanceof Error ? error.message : String(error);
  try {
    await convexClient().mutation(api.drive.setHealth, {
      key: convexKey(),
      health: "failing",
      kind,
      message,
    });
  } catch (inner) {
    console.error("Recording the Drive failure failed", inner);
  }
}

async function recordDriveHealthy(): Promise<void> {
  try {
    await convexClient().mutation(api.drive.setHealth, { key: convexKey(), health: "ok" });
  } catch (error) {
    console.error("Recording Drive health failed", error);
  }
}

/** How long a failing connection is left alone before a page load re-tries it. */
export const DRIVE_PROBE_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Ask Google whether the connection works: refresh the token and read the
 * folder. Records the answer either way. True when Drive is usable.
 *
 * Called from Settings by hand and, for an "unavailable" failure, from a
 * page load once the probe interval has passed — so an outage on Google's
 * side clears itself without a host doing anything. A revoked grant is
 * never re-probed: only reconnecting can fix it.
 */
export async function probeDrive(): Promise<boolean> {
  const connection = await storedConnection();
  if (!connection || !googleConfigured()) return false;
  try {
    const accessToken = await accessTokenFor(connection);
    const response = await driveFetch(
      accessToken,
      `${DRIVE_API}/files/${encodeURIComponent(connection.folderId)}?fields=id`
    );
    if (!response.ok) throw new DriveError(`Google answered ${response.status} for the folder.`);
    await recordDriveHealthy();
    return true;
  } catch (error) {
    await recordDriveFailure(error);
    return false;
  }
}

/**
 * Arrange a re-probe of a failing-but-recoverable connection once the
 * interval has passed — after this response has gone out, never in its way.
 *
 * The page serves the recorded state as it stands. The claim is one small
 * mutation, and it is atomic: of the many requests that may notice the
 * interval at once, one wins and the rest do nothing, so Google gets a
 * single request per interval however busy the site is.
 */
export async function scheduleReprobe(connection: DriveConnection): Promise<DriveConnection> {
  if (connection.health !== "failing" || connection.failureKind === "revoked") return connection;
  if (Date.now() - (connection.lastCheckedAt ?? 0) < DRIVE_PROBE_INTERVAL_MS) return connection;

  try {
    const claimed = await convexClient().mutation(api.drive.claimProbe, {
      key: convexKey(),
      intervalMs: DRIVE_PROBE_INTERVAL_MS,
    });
    if (claimed) after(() => probeDrive());
  } catch (error) {
    console.error("Scheduling a Drive probe failed", error);
  }
  return connection;
}

/** What Settings shows. Never includes the token. */
export const getDriveConnection = cache(async (): Promise<DriveConnection | null> => {
  const row = await storedConnection();
  if (!row) return null;
  const { refreshTokenSealed: _sealed, ...connection } = row;
  void _sealed;
  return connection;
});

export async function saveDriveConnection(connection: {
  refreshToken: string;
  account: string;
  folderId: string;
  folderName: string;
  folderUrl: string;
}): Promise<void> {
  const { refreshToken, ...rest } = connection;
  tokenCache.clear();
  await convexClient().mutation(api.drive.set, {
    key: convexKey(),
    ...rest,
    refreshTokenSealed: await seal(refreshToken, authSecret()),
  });
}

export async function clearDriveConnection(): Promise<void> {
  tokenCache.clear();
  await convexClient().mutation(api.drive.clear, { key: convexKey() });
}

/* ---------------------------------------------------------- access token */

/**
 * Access tokens last an hour; one per refresh token is kept until a minute
 * before it expires. Per process, so each Vercel instance refreshes on its
 * own — a handful of token requests, not one per upload.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessTokenFor(connection: StoredConnection): Promise<string> {
  const cached = tokenCache.get(connection.refreshTokenSealed);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const refreshToken = await open(connection.refreshTokenSealed, authSecret());
  if (!refreshToken) {
    throw new DriveError(
      "The stored Drive connection cannot be read. Reconnect Google Drive from Settings.",
      "revoked"
    );
  }

  const json = await postToken({
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "refresh_token",
  });
  if (!json.access_token) throw new DriveError("Google did not return an access token.");

  tokenCache.set(connection.refreshTokenSealed, {
    token: json.access_token,
    expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
  });
  return json.access_token;
}

/* ----------------------------------------------------------------- drive */

async function driveFetch(
  accessToken: string,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401) {
    tokenCache.clear();
    throw new DriveError("Google refused the connection. Reconnect Google Drive.", "revoked");
  }
  return response;
}

/** Make the folder the photos will land in, inside the hosts' My Drive. */
export async function createFolder(
  accessToken: string,
  name: string
): Promise<{ id: string; url: string }> {
  const response = await driveFetch(accessToken, `${DRIVE_API}/files?fields=id,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!response.ok) throw new DriveError("Could not create the Drive folder.");
  const json = (await response.json()) as { id: string; webViewLink?: string };
  return {
    id: json.id,
    url: json.webViewLink ?? `https://drive.google.com/drive/folders/${json.id}`,
  };
}

/**
 * Open a resumable upload the phone can finish on its own.
 *
 * Google answers with a session URL that carries its own authorisation, so
 * the browser PUTs the bytes there with no token of ours in hand. The Origin
 * of the page is sent along on this request: that is what makes Google add
 * CORS headers to the browser's PUT.
 *
 * Null when Drive is not connected. That is a supported state, not an error:
 * the wall still works, originals just are not kept.
 */
export async function openUploadSession({
  name,
  mimeType,
  size,
  origin,
  sessionId,
}: {
  name: string;
  mimeType: string;
  size: number;
  origin: string;
  /**
   * The in-flight reservation this upload belongs to. Stamped into the
   * file's metadata here, at session open, where only the server writes;
   * the phone's PUT carries bytes and nothing else. Recording the photo
   * later requires the stamp to match, so a reservation can only ever be
   * consumed by the upload it authorised.
   */
  sessionId: string;
}): Promise<{ sessionUrl: string } | null> {
  if (!googleConfigured()) return null;
  const connection = await storedConnection();
  if (!connection) return null;

  const accessToken = await accessTokenFor(connection);
  const response = await driveFetch(
    accessToken,
    `${UPLOAD_API}/files?uploadType=resumable&fields=id,size,parents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(size),
        Origin: origin,
      },
      body: JSON.stringify({
        name,
        parents: [connection.folderId],
        appProperties: { session: sessionId },
      }),
    }
  );

  const sessionUrl = response.headers.get("location");
  if (!response.ok || !sessionUrl) throw new DriveError("Could not start the Drive upload.");
  return { sessionUrl };
}

/**
 * Whether a file id the phone reports really is a file in our folder.
 *
 * The finalize route trusts nothing about the Drive half that it cannot
 * check: a made-up id would otherwise be recorded as an original, and a
 * host's "delete for good" would later fail on it.
 */
export async function verifyUploadedFile(
  fileId: string
): Promise<
  { ok: true; size: number | null; createdAt: number | null; sessionTag: string | null } | { ok: false }
> {
  const connection = await storedConnection();
  if (!connection || !googleConfigured()) return { ok: false };

  const accessToken = await accessTokenFor(connection);
  const response = await driveFetch(
    accessToken,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,size,parents,createdTime,appProperties`
  );
  if (!response.ok) return { ok: false };

  const json = (await response.json()) as {
    id?: string;
    size?: string;
    parents?: string[];
    createdTime?: string;
    appProperties?: Record<string, string>;
  };
  if (json.id !== fileId || !json.parents?.includes(connection.folderId)) return { ok: false };
  const createdAt = json.createdTime ? Date.parse(json.createdTime) : NaN;
  return {
    ok: true,
    size: json.size ? Number(json.size) : null,
    createdAt: Number.isFinite(createdAt) ? createdAt : null,
    sessionTag: json.appProperties?.session ?? null,
  };
}

/* ------------------------------------------------------------- reconcile */

/**
 * Delete what is in the folder and recorded nowhere.
 *
 * The phone puts originals in Drive before the site hears of them, so the
 * folder can hold files no photo points at: an abandoned batch, a finalize
 * that failed, or someone uploading originals on purpose and never
 * finishing. Older than the grace period and unrecorded, they go. This is
 * what bounds a misuse of the guest password: whatever is pushed into the
 * folder without a photo on the wall lasts half an hour.
 *
 * Runs after a response, behind `claimReconcile`, so it costs a page load
 * nothing and happens at most once per interval however busy the site is.
 */
export async function reconcileDriveFolder(): Promise<{ deleted: number; done: boolean }> {
  const connection = await storedConnection();
  if (!connection || !googleConfigured()) return { deleted: 0, done: true };

  const client = convexClient();
  const startedAt = Date.now();
  const saveCursor = (cursor: string | null) =>
    client.mutation(api.drive.setReconcileCursor, { key: convexKey(), cursor });

  try {
    const accessToken = await accessTokenFor(connection);
    /*
     * Google returns at most a thousand files per page and a token for the
     * next. A run walks pages until it has read its share, spent its delete
     * budget, or used its time; the cursor is saved after every page, so
     * whatever stops a run, the next one carries on from the last page it
     * finished — and a page it did not finish is listed again, since its
     * remaining orphans are still there. A run that reaches the end clears
     * the cursor. Every file in the folder is therefore looked at, however
     * many there are and however slow Google is on the day.
     */
    let pageToken: string | null = connection.reconcileCursor ?? null;
    let deleted = 0;
    let restarted = false;
    for (let page = 0; page < RECONCILE_PAGES_PER_RUN; page++) {
      const params = new URLSearchParams({
        q: `'${connection.folderId}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,createdTime)",
        pageSize: "1000",
        orderBy: "createdTime",
        ...(pageToken ? { pageToken } : {}),
      });
      const response = await driveFetch(accessToken, `${DRIVE_API}/files?${params}`);

      /*
       * Page tokens expire, and Google says a rejected one must be thrown
       * away. A saved token that comes back refused is dropped and the walk
       * starts from the first page — once; a first page that fails is a
       * real failure.
       */
      if (!response.ok && pageToken && !restarted && response.status >= 400 && response.status < 500) {
        console.log(`Drive rejected the saved page token (${response.status}); starting the folder over.`);
        pageToken = null;
        restarted = true;
        await saveCursor(null);
        page -= 1;
        continue;
      }
      if (!response.ok) throw new DriveError(`Google answered ${response.status} listing the folder.`);
      const body = (await response.json()) as { files?: FolderFile[]; nextPageToken?: string };
      const files = body.files ?? [];

      /*
       * Which of these are recorded, asked in batches the query enforces.
       * An id the query never checked would read as unrecorded, and
       * unrecorded is what gets deleted — so no id may go unchecked.
       */
      const recorded = new Set<string>();
      for (let i = 0; i < files.length; i += RECORDED_IDS_BATCH) {
        const batch = files.slice(i, i + RECORDED_IDS_BATCH).map((f) => f.id);
        for (const id of await client.query(api.photos.recordedDriveIds, { key: convexKey(), ids: batch })) {
          recorded.add(id);
        }
      }

      const orphans = orphansToDelete(files, recorded, Date.now(), undefined, Number.MAX_SAFE_INTEGER);
      let outOfBudget = false;
      for (const id of orphans) {
        if (deleted >= RECONCILE_MAX_DELETES || Date.now() - startedAt > RECONCILE_TIME_BUDGET_MS) {
          outOfBudget = true;
          break;
        }
        const gone = await driveFetch(accessToken, `${DRIVE_API}/files/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (gone.ok || gone.status === 404) deleted += 1;
      }

      if (outOfBudget) {
        // This page is not finished: come back to it, not past it.
        await saveCursor(pageToken);
        if (deleted > 0) console.log(`Reconciled the Drive folder: ${deleted} unrecorded file(s) removed; more next run.`);
        return { deleted, done: false };
      }

      pageToken = body.nextPageToken ?? null;
      await saveCursor(pageToken);
      if (!pageToken || Date.now() - startedAt > RECONCILE_TIME_BUDGET_MS) break;
    }

    if (deleted > 0) console.log(`Reconciled the Drive folder: ${deleted} unrecorded file(s) removed.`);
    return { deleted, done: pageToken === null };
  } catch (error) {
    console.error("Reconciling the Drive folder failed", error);
    await recordDriveFailure(error);
    return { deleted: 0, done: false };
  }
}

/**
 * Arrange a reconcile after this response, if one is due.
 *
 * Checked against the row first, so the many page loads that are not due
 * cost no mutation; the claim itself is what makes the one that is due
 * exclusive.
 */
export async function scheduleReconcile(connection: DriveConnection): Promise<void> {
  if (!googleConfigured()) return;
  if (Date.now() - (connection.lastReconciledAt ?? 0) < RECONCILE_INTERVAL_MS) return;
  try {
    const claimed = await convexClient().mutation(api.drive.claimReconcile, {
      key: convexKey(),
      intervalMs: RECONCILE_INTERVAL_MS,
    });
    if (claimed) after(() => reconcileDriveFolder());
  } catch (error) {
    console.error("Scheduling a Drive reconcile failed", error);
  }
}

/** Delete an original. True if it is gone, including when it already was. */
export async function deleteFile(fileId: string): Promise<boolean> {
  const connection = await storedConnection();
  if (!connection || !googleConfigured()) return false;

  const accessToken = await accessTokenFor(connection);
  const response = await driveFetch(
    accessToken,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE" }
  );
  return response.ok || response.status === 404;
}
