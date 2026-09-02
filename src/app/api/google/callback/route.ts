import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/auth";
import {
  STATE_COOKIE,
  accountEmail,
  createFolder,
  exchangeCode,
  googleConfigured,
  saveDriveConnection,
} from "@/lib/google-drive";
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
    const [account, settings] = await Promise.all([accountEmail(accessToken), getSettings()]);

    const folderName = `${settings.babyName} — photo wall`;
    const folder = await createFolder(accessToken, folderName);

    await saveDriveConnection({
      refreshToken,
      account,
      folderId: folder.id,
      folderName,
      folderUrl: folder.url,
    });
    return back(origin, "connected");
  } catch (error) {
    console.error("Connecting Google Drive failed", error);
    return back(origin, "error");
  }
}
