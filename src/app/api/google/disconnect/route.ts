import { NextResponse } from "next/server";
import { clearDriveConnection } from "@/lib/google-drive";
import { isAdminSession } from "@/lib/session";

/*
 * POST /api/google/disconnect — hosts only.
 *
 * Forgets the stored connection. The folder and every photo in it stay in
 * the hosts' Drive; only this site loses the ability to add to it. A host
 * who also wants Google to forget the grant does that from their Google
 * account's connected-apps page.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (!(await isAdminSession())) return NextResponse.redirect(new URL("/admin", origin), 303);

  try {
    await clearDriveConnection();
    return NextResponse.redirect(new URL("/admin/settings?tab=photos&drive=disconnected", origin), 303);
  } catch (error) {
    console.error("Disconnecting Google Drive failed", error);
    return NextResponse.redirect(new URL("/admin/settings?tab=photos&drive=error", origin), 303);
  }
}
