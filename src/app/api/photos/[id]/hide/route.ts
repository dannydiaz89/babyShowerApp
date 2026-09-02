import { NextResponse } from "next/server";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { convexClient, convexKey } from "@/lib/convex";
import { photoCaller } from "@/lib/photos";
import { PHOTO_RATE, photoIdParam, refuse, withinLimit } from "@/lib/photo-routes";

/*
 * POST /api/photos/:id/hide
 *
 * A guest's "remove". Takes the photo off the wall; deletes nothing. The
 * ownership check is in the mutation, against the device cookie, and a host
 * may hide anything.
 */

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await photoCaller();
  if (!caller.role) return refuse("signed-out", 401);

  const id = photoIdParam((await context.params).id);
  if (!id) return refuse("not-found", 404);

  // A guest with no device cookie has uploaded nothing from this device.
  if (caller.role === "guest" && !caller.uploaderId) return refuse("forbidden", 403);

  if (
    caller.role === "guest" &&
    !(await withinLimit(`photos:hide:${caller.uploaderId}`, PHOTO_RATE.hides))
  ) {
    return refuse("rate-limited", 429);
  }

  try {
    const result = await convexClient().mutation(api.photos.hide, {
      key: convexKey(),
      id: id as Id<"photos">,
      by: caller.role,
      uploaderId: caller.role === "guest" ? caller.uploaderId : null,
    });
    if (!result.ok) return refuse("forbidden", 403);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Hiding a photo failed", error);
    return refuse("failed", 500);
  }
}
