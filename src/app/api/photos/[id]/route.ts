import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { convexClient, convexKey } from "@/lib/convex";
import { deleteFile } from "@/lib/google-drive";
import { photoCaller } from "@/lib/photos";
import { photoIdParam, refuse } from "@/lib/photo-routes";

/*
 * DELETE /api/photos/:id — hosts only. Gone for good.
 *
 * The row and the web copy go first, in one Convex transaction, so the wall
 * can never show a photo whose image is missing. The Drive original goes
 * after; if that fails the answer says so, and the file stays in a folder
 * the hosts can see and tidy by hand.
 */

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await photoCaller();
  if (caller.role !== "host") return refuse(caller.role ? "forbidden" : "signed-out", caller.role ? 403 : 401);

  const id = photoIdParam((await context.params).id);
  if (!id) return refuse("not-found", 404);

  let driveFileId: string | null;
  try {
    ({ driveFileId } = await convexClient().mutation(api.photos.remove, {
      key: convexKey(),
      id: id as Id<"photos">,
    }));
  } catch (error) {
    console.error("Deleting a photo failed", error);
    return refuse("failed", 500);
  }

  let driveDeleted: boolean | null = null;
  if (driveFileId) {
    try {
      driveDeleted = await deleteFile(driveFileId);
    } catch (error) {
      console.error("Deleting the Drive original failed", error);
      driveDeleted = false;
    }
  }

  return NextResponse.json({ ok: true, driveDeleted });
}
