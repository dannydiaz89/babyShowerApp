import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/auth";
import {
  STATE_COOKIE,
  accountEmail,
  createFolder,
  exchangeCode,
  existingFolder,
  findFolder,
  getDriveConnection,
  googleConfigured,
  saveDriveConnection,
} from "@/lib/google-drive";
import { photoFolderName } from "@/lib/photo-wall";
import { isAdminSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";

/*
 * GET /api/google/callback — where Google sends the host back.
 *
 * Trades the code for tokens, makes the photo folder, and stores the
 * connection. Every exit lands on the Photos settings tab with a `drive=`
 * word the page turns into a message, so a host is never left on a blank
 * API URL wondering what happened.
 */

export const dynamic = "force-dynamic";

function back(origin: string, outcome: string): NextResponse {
  return NextResponse.redirect(new URL(`/admin/settings?tab=photos&drive=${outcome}`, origin));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  if (!(await isAdminSession())) return NextResponse.redirect(new URL("/admin", origin));
  if (!googleConfigured()) return back(origin, "unconfigured");

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value ?? "";
  jar.delete(STATE_COOKIE);

  const state = url.searchParams.get("state") ?? "";
  if (!expectedState || !state || !safeEqual(state, expectedState)) return back(origin, "error");

  // The host clicked Cancel on Google's screen.
  if (url.searchParams.get("error")) return back(origin, "denied");

  const code = url.searchParams.get("code");
  if (!code) return back(origin, "error");

  try {
    const { accessToken, refreshToken } = await exchangeCode(code, `${origin}/api/google/callback`);
    const [account, settings, previous] = await Promise.all([
      accountEmail(accessToken),
      getSettings(),
      // Read before the save below overwrites it.
      getDriveConnection().catch(() => null),
    ]);

    const wanted = photoFolderName(settings.babyName, settings.startISO);

    /*
     * Reuse before creating. Drive is happy to hold two folders of the same
     * name, so a plain create on every connect would leave the hosts with a
     * pile of identical folders and their originals split between them. The
     * one this connection used comes first; a folder the site made earlier
     * under the same name is the fallback for when the stored row is gone.
     * Only when neither is there is a new one the right answer — which is
     * also what happens after the hosts revoke the grant in their Google
     * account, since the site can no longer see what it made.
     */
    const folder =
      (await existingFolder(accessToken, previous?.folderId)) ??
      (await findFolder(accessToken, wanted)) ??
      { ...(await createFolder(accessToken, wanted)), name: wanted };

    await saveDriveConnection({
      refreshToken,
      account,
      folderId: folder.id,
      // What the folder is actually called, which is not `wanted` when an
      // older one is reused: the hosts should read the name Drive shows.
      folderName: folder.name || wanted,
      folderUrl: folder.url,
    });
    return back(origin, "connected");
  } catch (error) {
    console.error("Connecting Google Drive failed", error);
    return back(origin, "error");
  }
}
