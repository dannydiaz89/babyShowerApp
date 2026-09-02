import { NextResponse } from "next/server";
import { PHOTO_ORIGINAL_MAX_BYTES } from "../../../../../convex/limits";
import { DriveError, openUploadSession } from "@/lib/google-drive";
import { ensureUploaderId, photoCaller, wallState } from "@/lib/photos";
import { PHOTO_RATE, refuse, withinLimit } from "@/lib/photo-routes";

/*
 * POST /api/photos/session
 *
 * Open a resumable upload in the hosts' Drive folder and hand the phone the
 * session URL. The phone then PUTs the original there itself; the bytes
 * never touch this server, which could not take them anyway — Vercel caps a
 * request body well below a phone photo.
 *
 * Answers `sessionUrl: null` when Drive is not connected. The wall still
 * works; originals are simply not kept, and Settings says so to the hosts.
 */

export const dynamic = "force-dynamic";

type Body = { name?: unknown; type?: unknown; size?: unknown };

export async function POST(request: Request) {
  const caller = await photoCaller();
  if (!caller.role) return refuse("signed-out", 401);

  const state = await wallState();
  if (!state.uploads && caller.role !== "host") return refuse("closed", 403);

  const uploaderId = await ensureUploaderId();
  if (!(await withinLimit(`photos:session:${uploaderId}`, PHOTO_RATE.sessions))) {
    return refuse("rate-limited", 429);
  }

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

  try {
    const session = await openUploadSession({
      name,
      mimeType: type,
      size,
      origin: new URL(request.url).origin,
    });
    return NextResponse.json({ sessionUrl: session?.sessionUrl ?? null });
  } catch (error) {
    console.error("Opening a Drive upload session failed", error);
    // A revoked connection is not going to fix itself on retry; say so.
    const status = error instanceof DriveError && error.kind === "revoked" ? 409 : 502;
    return refuse("drive", status);
  }
}
