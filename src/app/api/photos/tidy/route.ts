import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/auth";
import { getDriveConnection, googleConfigured, reconcileDriveFolder } from "@/lib/google-drive";
import { sweepStoredCopies } from "@/lib/photos";
import { getSettings } from "@/lib/settings";

/*
 * POST /api/photos/tidy — the Convex cron's endpoint (convex/tidy.ts).
 *
 * Authenticated with the shared server key, sent as a bearer token: the
 * same secret that lets the site call Convex lets Convex call this. Runs
 * the folder reconcile and the storage sweep, each continuing from where
 * its last run stopped, and answers with what it did.
 */

export const dynamic = "force-dynamic";

// Convex actions may run for minutes; Vercel functions may not.
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const expected = process.env.ADMIN_API_KEY;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(expected) && safeEqual(given, expected!);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const result: { drive: { deleted: number; done: boolean } | null; storage: { deleted: number; done: boolean } } = {
    drive: null,
    storage: await sweepStoredCopies(),
  };

  const settings = await getSettings();
  if (settings.photoStorage === "drive" && googleConfigured() && (await getDriveConnection())) {
    result.drive = await reconcileDriveFolder();
  }

  return NextResponse.json(result);
}
