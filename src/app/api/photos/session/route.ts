import { NextResponse } from "next/server";
import { PHOTO_ORIGINAL_MAX_BYTES } from "../../../../../convex/limits";
import { openUploadSession, recordDriveFailure } from "@/lib/google-drive";
import { ensureUploaderId, photoCaller, wallState } from "@/lib/photos";
import { getSettings } from "@/lib/settings";
import { openOutstanding, refuse, withinLimits } from "@/lib/photo-routes";

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

  // Counted here and given back when the upload is recorded, so what the
  // limit measures is sessions left open — see PHOTO_RATE.
  if (!(await openOutstanding())) return refuse("rate-limited", 429);

  try {
    const session = await openUploadSession({
      name,
      mimeType: type,
      size,
      origin: new URL(request.url).origin,
    });
    if (!session) return refuse("paused", 503);
    return NextResponse.json({ sessionUrl: session.sessionUrl });
  } catch (error) {
    console.error("Opening a Drive upload session failed", error);
    await recordDriveFailure(error);
    return refuse("paused", 503);
  }
}
