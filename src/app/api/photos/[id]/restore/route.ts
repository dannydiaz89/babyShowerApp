import { NextResponse } from "next/server";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { convexClient, convexKey } from "@/lib/convex";
import { photoCaller } from "@/lib/photos";
import { photoIdParam, refuse } from "@/lib/photo-routes";

/* POST /api/photos/:id/restore — hosts only. Puts a hidden photo back. */

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await photoCaller();
  if (caller.role !== "host") return refuse(caller.role ? "forbidden" : "signed-out", caller.role ? 403 : 401);

  const id = photoIdParam((await context.params).id);
  if (!id) return refuse("not-found", 404);

  try {
    const result = await convexClient().mutation(api.photos.restore, {
      key: convexKey(),
      id: id as Id<"photos">,
    });
    if (!result.ok) return refuse("not-found", 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Restoring a photo failed", error);
    return refuse("failed", 500);
  }
}
