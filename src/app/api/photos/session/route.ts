import { NextResponse } from "next/server";
import { PHOTO_ORIGINAL_MAX_BYTES } from "../../../../../convex/limits";
import { api } from "../../../../../convex/_generated/api";
import { convexClient, convexKey } from "@/lib/convex";
import { getDriveConnection, openUploadSession, recordDriveFailure, scheduleReconcile } from "@/lib/google-drive";
import { ensureUploaderId, photoCaller, wallState } from "@/lib/photos";
import { getSettings } from "@/lib/settings";
import { clientAddress, refuse, withinLimits } from "@/lib/photo-routes";

/*
 * POST /api/photos/session
 *
 * Open a resumable upload in the hosts' Drive folder and hand the phone the
 * session URL. The phone then PUTs the original there itself; the bytes
 * never touch this server, which could not take them anyway — Vercel caps a
 * request body well below a phone photo.
 *
 * Answers `sessionUrl: null` when the hosts chose "this site" as storage:
 * no original is kept, only the larger web copy. With Drive chosen, a
 * failure here is recorded on the connection so that uploads pause for
 * everyone until Google answers again, rather than each guest finding out
 * one photo at a time.
 */

export const dynamic = "force-dynamic";

type Body = { name?: unknown; type?: unknown; size?: unknown };

export async function POST(request: Request) {
  const caller = await photoCaller();
  if (!caller.role) return refuse("signed-out", 401);

  const state = await wallState();
  // A pause holds for hosts too: it is the storage that is not ready, not
  // the guest. A closed wall a host may still test.
  if (state.paused) return refuse("paused", 503);
  if (!state.uploads && caller.role !== "host") return refuse("closed", 403);

  const uploaderId = await ensureUploaderId();
  if (!uploaderId) return refuse("rate-limited", 429);
  if (!(await withinLimits("session", uploaderId))) return refuse("rate-limited", 429);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return refuse("bad-request", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 255) : "";
  const type = typeof body.type === "string" ? body.type : "";
  const size = typeof body.size === "number" && Number.isFinite(body.size) ? body.size : NaN;

  if (!name || !type.startsWith("image/") || !(size >= 1)) return refuse("bad-request", 400);
  if (size > PHOTO_ORIGINAL_MAX_BYTES) return refuse("too-large", 413);

  const { photoStorage } = await getSettings();
  if (photoStorage !== "drive") return NextResponse.json({ sessionUrl: null });

  /*
   * Room in the in-flight budget first: the bytes about to head for Drive
   * count as open until the photo is recorded. This, not the request
   * counts, is what stops a script filling the folder — see limits.ts.
   */
  let sessionId: string;
  try {
    const reserved = await convexClient().mutation(api.photos.openSession, {
      key: convexKey(),
      uploaderId,
      address: await clientAddress(),
      size,
    });
    if (!reserved.ok) return refuse("rate-limited", 429);
    sessionId = reserved.sessionId;
  } catch (error) {
    console.error("Reserving in-flight room failed", error);
    return refuse("failed", 500);
  }

  try {
    const session = await openUploadSession({
      name,
      mimeType: type,
      size,
      origin: new URL(request.url).origin,
    });
    if (!session) return refuse("paused", 503);
    // Opening is when the folder gains files; tidy it on the same cadence.
    const connection = await getDriveConnection();
    if (connection) await scheduleReconcile(connection);
    return NextResponse.json({ sessionUrl: session.sessionUrl, sessionId });
  } catch (error) {
    console.error("Opening a Drive upload session failed", error);
    await recordDriveFailure(error);
    return refuse("paused", 503);
  }
}
