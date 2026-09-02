import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { STATE_COOKIE, authorizationUrl, googleConfigured } from "@/lib/google-drive";
import { isAdminSession } from "@/lib/session";

/*
 * GET /api/google/start — hosts only.
 *
 * Sends the host to Google to grant the app its own folder in their Drive.
 * The `state` value is minted here, kept in a short-lived cookie, and
 * checked by the callback: it is what stops a crafted link from attaching
 * someone else's Google account to this site.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  if (!(await isAdminSession())) {
    return NextResponse.redirect(new URL("/admin", origin));
  }
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/admin/settings?tab=photos&drive=unconfigured", origin));
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/google",
    maxAge: 10 * 60,
  });

  return NextResponse.redirect(
    authorizationUrl({ redirectUri: `${origin}/api/google/callback`, state })
  );
}
